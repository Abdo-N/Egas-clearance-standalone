import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useTheme } from "../context/ThemeContext";
import { formatDate } from "../utils/formatDate";
import { REASONS, reasonI18nKey } from "../utils/leavingReason";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const REASON_KEYS = REASONS;
const OVERDUE_DAYS = 7;
const UPCOMING_DAYS = 7;
const RECENT_LIMIT = 8;
const TOP_EMPLOYEE_DEPTS = 8;

// Mirrors --chart-approved/pending/halted/locked in styles.css. Recharts sets
// fill/stroke as raw SVG attributes (not CSS properties), which can't resolve
// var(...) -- so the same values are duplicated here, per theme.
const CHART_COLORS = {
  light: { approved: "#14874e", pending: "#d6a82d", halted: "#9d1135", locked: "#2266a4", surface: "#fcfcfb" },
  dark: { approved: "#04ab62", pending: "#a67628", halted: "#b6143f", locked: "#3c7ebe", surface: "#17251f" },
};

function monthLabel(key, lang) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    month: "short",
    year: "2-digit",
  });
}

function lastNMonthKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function ownDeptOf(request, departmentKey) {
  return request.departments.find((d) => d.departmentKey === departmentKey);
}

function isDueSoon(request, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastDay = new Date(request.lastWorkingDay);
  const daysUntil = (lastDay - today) / MS_PER_DAY;
  return daysUntil >= 0 && daysUntil <= UPCOMING_DAYS;
}

// Which real EGAS department the employees going through clearance actually
// work in (`employeeDepartment_ar/en` -- unrelated to the 13 signing
// departments). Every reviewer already sees this per-request (it's never
// redacted), so surfacing it aggregated on the dashboard doesn't expose
// anything new.
function employeeDeptBreakdown(plainRequests) {
  const byDept = {};
  plainRequests.forEach((r) => {
    const key = r.employeeDepartment_en || r.employeeDepartment_ar || "—";
    if (!byDept[key]) byDept[key] = { name_ar: r.employeeDepartment_ar || "—", name_en: r.employeeDepartment_en || "—", count: 0 };
    byDept[key].count += 1;
  });
  return Object.values(byDept)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_EMPLOYEE_DEPTS);
}

// A department entry is "done" once its single signature landed, or (IT)
// once every itemized checklist entry has. Returns the timestamp that
// counts as "signed off" for turnaround-time math, or null if not done yet.
function deptSignedAt(dept) {
  if (!dept) return null;
  if (dept.signatureMode === "itemized") {
    if (!dept.items.length || !dept.items.every((i) => i.status === "completed")) return null;
    return dept.items.reduce(
      (latest, i) => (!latest || new Date(i.signedAt) > new Date(latest) ? i.signedAt : latest),
      null
    );
  }
  return dept.status === "completed" ? dept.signedAt : null;
}

// Everything a single (tier-1 or itemized) department needs for its own
// dashboard: scoped strictly to requests that ever reached THIS department,
// never other departments' data -- matches the same need-to-know visibility
// the backend already enforces on `requests`.
function computeOwnStats(requests, departmentKey) {
  const entries = requests
    .map((r) => ({ request: r, dept: ownDeptOf(r, departmentKey) }))
    .filter((e) => e.dept);

  const completedEntries = entries.filter((e) => e.dept.status === "completed");
  const pendingEntries = entries.filter((e) => e.dept.needsAction);
  const now = new Date();
  const overdueCount = pendingEntries.filter(
    (e) => (now - new Date(e.request.createdAt)) / MS_PER_DAY > OVERDUE_DAYS
  ).length;
  const dueSoonCount = pendingEntries.filter((e) => isDueSoon(e.request, now)).length;

  const turnarounds = completedEntries
    .map((e) => {
      const signedAt = deptSignedAt(e.dept);
      return signedAt ? (new Date(signedAt) - new Date(e.request.createdAt)) / MS_PER_DAY : null;
    })
    .filter((v) => v != null);
  const avgTurnaround = turnarounds.length
    ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
    : null;

  const byReason = Object.fromEntries(REASON_KEYS.map((k) => [k, 0]));
  entries.forEach((e) => {
    byReason[e.request.reason] = (byReason[e.request.reason] || 0) + 1;
  });

  const monthKeys = lastNMonthKeys(6);
  const monthly = Object.fromEntries(monthKeys.map((k) => [k, 0]));
  entries.forEach((e) => {
    const d = new Date(e.request.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key in monthly) monthly[key] += 1;
  });

  const recent = [...entries]
    .sort((a, b) => new Date(b.request.updatedAt || b.request.createdAt) - new Date(a.request.updatedAt || a.request.createdAt))
    .slice(0, RECENT_LIMIT);

  return {
    total: entries.length,
    completedCount: completedEntries.length,
    pendingCount: pendingEntries.length,
    overdueCount,
    dueSoonCount,
    avgTurnaround,
    byReason,
    monthKeys,
    monthly,
    byEmployeeDept: employeeDeptBreakdown(entries.map((e) => e.request)),
    recent,
  };
}

// Oversight (wages/finance) reviewers get the un-redacted `departments[]` on
// every request, so their dashboard can aggregate across all 13 departments
// instead of just their own -- this is the one dashboard flavor that's
// allowed to show company-wide numbers, matching their existing full-grid
// visibility.
function computeCompanyStats(requests) {
  const completed = requests.filter((r) => r.status === "completed");
  const now = new Date();
  const overdueCount = requests.filter(
    (r) => r.status !== "completed" && (now - new Date(r.createdAt)) / MS_PER_DAY > OVERDUE_DAYS
  ).length;
  const dueSoonCount = requests.filter((r) => r.status !== "completed" && isDueSoon(r, now)).length;
  const turnarounds = completed
    .filter((r) => r.completedAt)
    .map((r) => (new Date(r.completedAt) - new Date(r.createdAt)) / MS_PER_DAY);
  const avgTurnaround = turnarounds.length
    ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
    : null;

  const byReason = Object.fromEntries(REASON_KEYS.map((k) => [k, 0]));
  requests.forEach((r) => {
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  });

  const monthKeys = lastNMonthKeys(6);
  const monthly = Object.fromEntries(monthKeys.map((k) => [k, 0]));
  requests.forEach((r) => {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key in monthly) monthly[key] += 1;
  });

  const byDept = {};
  requests.forEach((r) => {
    r.departments.forEach((d) => {
      if (!byDept[d.departmentKey]) {
        byDept[d.departmentKey] = { name_ar: d.name_ar, name_en: d.name_en, order: d.order, total: 0, completed: 0 };
      }
      byDept[d.departmentKey].total += 1;
      if (d.status === "completed") byDept[d.departmentKey].completed += 1;
    });
  });

  const recent = [...requests]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, RECENT_LIMIT);

  return {
    total: requests.length,
    completedCount: completed.length,
    inProgressCount: requests.length - completed.length,
    overdueCount,
    dueSoonCount,
    avgTurnaround,
    byReason,
    monthKeys,
    monthly,
    byDept: Object.entries(byDept).sort((a, b) => a[1].order - b[1].order),
    byEmployeeDept: employeeDeptBreakdown(requests),
    recent,
  };
}

function StatTile({ value, label, tone }) {
  return (
    <div className={`detail-stat-tile${tone ? ` detail-stat-tile--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="egas-chart-tooltip">
      {payload.map((entry) => (
        <div key={entry.dataKey || entry.name}>
          {entry.name}: <strong>{entry.value}</strong>
        </div>
      ))}
    </div>
  );
}

function CompletionRing({ pct, total, completed, caption, colors }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="egas-chart-card egas-ring-card">
      <div className="egas-ring-wrap">
        <svg viewBox="0 0 100 100">
          <circle className="egas-ring-track" cx="50" cy="50" r={radius} />
          <circle
            className="egas-ring-fill"
            cx="50"
            cy="50"
            r={radius}
            stroke={colors.approved}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
          />
        </svg>
        <div className="egas-ring-value">
          <strong>{pct}%</strong>
          <span>
            {completed}/{total}
          </span>
        </div>
      </div>
      <p className="egas-ring-caption">{caption}</p>
    </div>
  );
}

function StatusPie({ title, segments, surfaceColor }) {
  return (
    <div className="egas-chart-card">
      <p className="egas-chart-card-title">{title}</p>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={segments} dataKey="value" nameKey="label" innerRadius={48} outerRadius={75} paddingAngle={3}>
            {segments.map((s) => (
              <Cell key={s.key} fill={s.color} stroke={surfaceColor} strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="egas-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className="egas-legend-swatch" style={{ backgroundColor: s.color }} />
            {s.label} ({s.value})
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryBarChart({ title, rows, lockedColor }) {
  const height = Math.max(140, rows.length * 34);
  const shortenLabel = (label) => label.length > 22 ? `${label.slice(0, 20)}…` : label;
  return (
    <div className="egas-chart-card">
      <p className="egas-chart-card-title">{title}</p>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={lockedColor} opacity={0.15} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "var(--ink-700)" }} />
          <YAxis
            type="category"
            dataKey="label"
            width={135}
            tickFormatter={shortenLabel}
            tick={{ fontSize: 11, fill: "var(--ink-700)" }}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={18}>
            {rows.map((r) => (
              <Cell key={r.label} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DepartmentDashboard({ requests, user }) {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const colors = CHART_COLORS[theme] || CHART_COLORS.light;
  const isAr = i18n.language === "ar";
  const isOversight = Boolean(user.hasOversightDashboard);
  const isFileManagement = user.role === "file_management";
  // Oversight reviewers (Wages/Finance) and File Management both already see
  // every one of a request's 13 departments (full detail for oversight, a
  // status-only summary for File Management) -- neither is scoped to a
  // single department, so both get the aggregated company-wide dashboard
  // instead of the own-department one.
  const useCompanyStats = isOversight || isFileManagement;

  const ownStats = useMemo(
    () => (useCompanyStats ? null : computeOwnStats(requests, user.departmentKey)),
    [requests, user.departmentKey, useCompanyStats]
  );
  const companyStats = useMemo(() => (useCompanyStats ? computeCompanyStats(requests) : null), [requests, useCompanyStats]);

  const stats = useCompanyStats ? companyStats : ownStats;
  if (!stats || requests.length === 0) return null;

  const ringPct = stats.total > 0 ? Math.round((stats.completedCount / stats.total) * 100) : 0;

  // Ordinary reviewers only need an at-a-glance view of their own queue.
  // Company-wide charts remain exclusive to oversight and File Management.
  if (!useCompanyStats) {
    const outstandingCount = Math.max(0, stats.total - stats.completedCount);
    return (
      <div className="egas-dashboard egas-dashboard--simple">
        <h3 className="egas-dashboard-heading">{t("reviewer.dashboardDepartmentOverview")}</h3>
        <div className="detail-stat-row department-summary-stats">
          <StatTile value={stats.total} label={t("reviewer.dashboardTotal")} />
          <StatTile value={stats.completedCount} label={t("reviewer.dashboardCompleted")} tone="completed" />
          <StatTile value={outstandingCount} label={t("reviewer.dashboardOutstanding")} tone="pending" />
          <StatTile value={stats.pendingCount} label={t("reviewer.dashboardPending")} tone="pending" />
          <StatTile value={stats.dueSoonCount} label={t("reviewer.dashboardDueSoon")} tone={stats.dueSoonCount > 0 ? "overdue" : undefined} />
        </div>
        <div className="department-completion-summary">
          <div>
            <span>{t("reviewer.dashboardCompletionRate")}</span>
            <strong>{ringPct}%</strong>
          </div>
          <div className="department-completion-track" aria-hidden="true">
            <span style={{ width: `${ringPct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  const reasonRows = REASON_KEYS.map((key) => ({
    label: t(`employee.${reasonI18nKey(key)}`),
    value: stats.byReason[key],
    color: colors.approved,
  })).filter((row) => row.value > 0);

  const monthRows = stats.monthKeys.map((key) => ({
    label: monthLabel(key, i18n.language),
    value: stats.monthly[key],
    color: colors.pending,
  }));

  return (
    <div className="egas-dashboard">
      <h3 className="egas-dashboard-heading">
        {useCompanyStats ? t("reviewer.dashboardCompanyOverview") : t("reviewer.dashboardTotal")}
      </h3>

      <div className="detail-stat-row">
        <StatTile value={stats.total} label={t("reviewer.dashboardTotal")} />
        {useCompanyStats ? (
          <>
            <StatTile value={stats.completedCount} label={t("reviewer.dashboardOverallCompleted")} tone="completed" />
            <StatTile value={stats.inProgressCount} label={t("reviewer.dashboardOverallInProgress")} tone="pending" />
          </>
        ) : (
          <>
            <StatTile value={stats.pendingCount} label={t("reviewer.dashboardPending")} tone="pending" />
            <StatTile value={stats.completedCount} label={t("reviewer.dashboardCompleted")} tone="completed" />
          </>
        )}
        <StatTile
          value={stats.avgTurnaround != null ? `${stats.avgTurnaround.toFixed(1)} ${t("reviewer.dashboardAvgTurnaroundUnit")}` : "—"}
          label={t("reviewer.dashboardAvgTurnaround")}
        />
        <StatTile value={stats.overdueCount} label={t("reviewer.dashboardOverdue")} tone={stats.overdueCount > 0 ? "overdue" : undefined} />
        <StatTile value={stats.dueSoonCount} label={t("reviewer.dashboardDueSoon")} tone={stats.dueSoonCount > 0 ? "pending" : undefined} />
      </div>

      <div className="egas-chart-grid">
        <CompletionRing
          pct={ringPct}
          total={stats.total}
          completed={stats.completedCount}
          caption={t("reviewer.dashboardStatusBreakdown")}
          colors={colors}
        />

        <StatusPie
          title={t("reviewer.dashboardStatusBreakdown")}
          surfaceColor={colors.surface}
          segments={(
            useCompanyStats
              ? [
                  { key: "completed", label: t("reviewer.dashboardOverallCompleted"), value: stats.completedCount, color: colors.approved },
                  { key: "pending", label: t("reviewer.dashboardOverallInProgress"), value: stats.inProgressCount, color: colors.pending },
                ]
              : [
                  { key: "completed", label: t("reviewer.dashboardCompleted"), value: stats.completedCount, color: colors.approved },
                  { key: "pending", label: t("reviewer.dashboardPending"), value: stats.pendingCount, color: colors.pending },
                  {
                    key: "other",
                    label: t("employee.statusInProgress"),
                    value: Math.max(0, stats.total - stats.completedCount - stats.pendingCount),
                    color: colors.locked,
                  },
                ]
          ).filter((segment) => segment.value > 0)}
        />

        <CategoryBarChart title={t("reviewer.dashboardReasonBreakdown")} rows={reasonRows} lockedColor={colors.locked} />
        <CategoryBarChart title={t("reviewer.dashboardMonthlyTrend")} rows={monthRows} lockedColor={colors.locked} />

        {useCompanyStats && (
          <>
            <CategoryBarChart
              title={t("reviewer.dashboardDeptWorkload")}
              lockedColor={colors.locked}
              rows={stats.byDept.map(([, d]) => ({
                label: isAr ? d.name_ar : d.name_en,
                value: d.total - d.completed,
                color: colors.pending,
              }))}
            />
            <CategoryBarChart
              title={t("reviewer.dashboardDeptPerformance")}
              lockedColor={colors.locked}
              rows={stats.byDept.map(([, d]) => ({
                label: isAr ? d.name_ar : d.name_en,
                value: d.total ? Math.round((d.completed / d.total) * 100) : 0,
                color: colors.approved,
              }))}
            />
          </>
        )}

        {stats.byEmployeeDept.length > 0 && (
          <CategoryBarChart
            title={t("reviewer.dashboardEmployeeDeptBreakdown")}
            lockedColor={colors.locked}
            rows={stats.byEmployeeDept.map((d) => ({
              label: isAr ? d.name_ar : d.name_en,
              value: d.count,
              color: colors.locked,
            }))}
          />
        )}

        <div className="egas-chart-card" style={{ gridColumn: "1 / -1" }}>
          <p className="egas-chart-card-title">{t("reviewer.dashboardRecentActivity")}</p>
          {stats.recent.length === 0 ? (
            <p>{t("reviewer.dashboardNoActivity")}</p>
          ) : (
            <ul className="activity-list">
              {stats.recent.map((entry) => {
                const request = useCompanyStats ? entry : entry.request;
                const dept = useCompanyStats ? null : entry.dept;
                const isCompleted = useCompanyStats ? request.status === "completed" : dept.status === "completed";
                return (
                  <li key={request._id} className="activity-list-row">
                    <span className="activity-list-employee">
                      <strong>{request.employeeFullName}</strong>
                      <small>{t(`employee.${reasonI18nKey(request.reason)}`)}</small>
                    </span>
                    <span className={`status-pill ${isCompleted ? "completed" : "pending"}`}>
                      {useCompanyStats
                        ? (isCompleted ? t("reviewer.dashboardOverallCompleted") : t("reviewer.dashboardOverallInProgress"))
                        : (isCompleted ? t("reviewer.dashboardCompleted") : t("reviewer.dashboardPending"))}
                    </span>
                    {request.accessRevoked && (
                      <span className="status-pill archived">{t("common.accessRevokedBadge")}</span>
                    )}
                    <small className="activity-list-date">
                      {formatDate(request.updatedAt || request.createdAt, i18n.language)}
                    </small>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
