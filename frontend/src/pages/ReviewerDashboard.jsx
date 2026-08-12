import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import TopBarControls from "../components/TopBarControls";
import BusinessDoodleBg from "../components/BusinessDoodleBg";
import SignaturePanel from "../components/SignaturePanel";
import PasswordInput from "../components/PasswordInput";
import RequestOversightGrid from "../components/RequestOversightGrid";
import DepartmentDashboard from "../components/DepartmentDashboard";
import EmployeeSearchFilter from "../components/EmployeeSearchFilter";
import SortableTableHeader, { isRequestOlderThanSevenDays, nextSort, sortTableRows } from "../components/SortableTableHeader";
import { formatDate } from "../utils/formatDate";
import { reasonI18nKey } from "../utils/leavingReason";
import logoUrl from "../assets/egas-logo.png";

function departmentStatusPill(request, dept, t, showArchivedMarker) {
  const awaitingAdRemoval = showArchivedMarker && dept?.itAwaitingRevocation && !request.accessRevoked;
  if (showArchivedMarker && request.accessRevoked) {
    return { modifier: "archived", label: t("reviewer.accessRevokedBadgeIt") };
  }
  if (awaitingAdRemoval) {
    return { modifier: "awaiting-ad", label: t("reviewer.awaitingAdRemovalBadge") };
  }
  return dept?.status === "completed"
    ? { modifier: "completed", label: t("employee.departmentCompleted") }
    : { modifier: "pending", label: t("employee.departmentPending") };
}

// Department request lists intentionally mirror File Management's table,
// while the status remains scoped to the signed-in department.
function RequestTable({ requests, getDept, t, lang, onOpen, showArchivedMarker }) {
  const [sort, setSort] = useState({ key: null, direction: null });
  const sortedRequests = sortTableRows(requests, sort, {
    employee: (request) => request.employeeFullName,
    jobTitle: (request) => request.employeeJobTitle,
    reason: (request) => t(`employee.${reasonI18nKey(request.reason)}`),
    lastWorkingDay: (request) => new Date(request.lastWorkingDay).getTime(),
    status: (request) => {
      const modifier = departmentStatusPill(request, getDept(request), t, showArchivedMarker).modifier;
      if (modifier === "pending") return 3;
      if (modifier === "awaiting-ad") return 2;
      return 1;
    },
    submittedOn: (request) => new Date(request.createdAt).getTime(),
  }, lang);
  const handleSort = (key) => setSort((current) => nextSort(current, key));

  return (
    <div className="admin-table-wrapper">
      <table className="admin-table">
        <thead>
          <tr>
            <SortableTableHeader columnKey="employee" label={t("reviewer.employee")} sort={sort} onSort={handleSort} />
            <SortableTableHeader columnKey="jobTitle" label={t("fileManagement.jobTitleLabel")} sort={sort} onSort={handleSort} />
            <SortableTableHeader columnKey="reason" label={t("employee.reasonLabel")} sort={sort} onSort={handleSort} />
            <SortableTableHeader columnKey="lastWorkingDay" label={t("employee.lastWorkingDayLabel")} sort={sort} onSort={handleSort} />
            <SortableTableHeader columnKey="status" label={t("employee.statusLabel")} sort={sort} onSort={handleSort} />
            <SortableTableHeader columnKey="submittedOn" label={t("employee.requestedOn")} sort={sort} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {sortedRequests.map((request) => {
            const pill = departmentStatusPill(request, getDept(request), t, showArchivedMarker);
            const unresolved = pill.modifier !== "completed" && pill.modifier !== "archived";
            const overdue = unresolved && isRequestOlderThanSevenDays(request);
            return (
              <tr
                key={request._id}
                tabIndex={0}
                onClick={() => onOpen(request._id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(request._id);
                  }
                }}
              >
                <td>{request.employeeFullName} <small>#{request.employeeNumber}</small></td>
                <td>{request.employeeJobTitle || "—"}</td>
                <td>{t(`employee.${reasonI18nKey(request.reason)}`)}</td>
                <td>{formatDate(request.lastWorkingDay, lang)}</td>
                <td>
                  <span className="status-pill-group">
                    <span className={`status-pill ${pill.modifier}`}>{pill.label}</span>
                    {overdue && <span className="status-pill status-pill--overdue">{t("common.overdueBadge")}</span>}
                  </span>
                </td>
                <td>{formatDate(request.createdAt, lang)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// "Revoke access" -- IT's capstone action, only enabled once every one of
// the 13 departments has signed. Just a password re-auth, no file (it's a
// system action, not a signature).
function RevokeAccessForm({ onSubmit, busy, t }) {
  const [password, setPassword] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!password) return;
    onSubmit(password);
    setPassword("");
  }

  return (
    <form className="signature-form revoke-access-form" onSubmit={handleSubmit}>
      <p>{t("reviewer.revokeAccessHint")}</p>
      <div className="form-group">
        <label>{t("signature.passwordLabel")}</label>
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" className="reject-button" disabled={busy || !password}>
        {busy ? t("reviewer.archiving") : t("reviewer.revokeAccessButton")}
      </button>
    </form>
  );
}

// IT-only: issue ANY account (another IT reviewer, a plain department
// reviewer, or File Management) a fresh one-time password when they've
// forgotten theirs -- there's no email infrastructure in this app to send a
// reset link through instead (see CLAUDE.md), so IT hands this off directly.
// Account-level, not tied to any clearance request, so it lives on the
// request list screen rather than inside a request's detail panel.
function ResetPasswordPanel({ t }) {
  const [open, setOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { data } = await client.post("/auth/reset-password", { userID: targetEmail, password });
      setResult(data);
      setTargetEmail("");
      setPassword("");
    } catch (err) {
      setError(err.response?.data?.error || t("reviewer.resetPasswordError"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard?.writeText(result.oneTimePassword);
    setCopied(true);
  }

  function handleDismiss() {
    setResult(null);
    setCopied(false);
    setOpen(false);
  }

  if (result) {
    return (
      <section className="detail-panel" style={{ marginBottom: 16 }}>
        <h3>{t("reviewer.resetPasswordSuccessTitle")}</h3>
        <p>{t("reviewer.resetPasswordSuccessHint", { name: result.fullName })}</p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            margin: "10px 0",
            borderRadius: 8,
            background: "var(--card, #f4f5f6)",
            border: "1px dashed var(--line, #d1d5db)"
          }}
        >
          <code style={{ fontSize: 16, letterSpacing: 1 }}>{result.oneTimePassword}</code>
          <button type="button" className="secondary-button" onClick={handleCopy}>
            {copied ? t("reviewer.resetPasswordCopied") : t("reviewer.resetPasswordCopy")}
          </button>
        </div>
        <button type="button" className="secondary-button" onClick={handleDismiss}>
          {t("reviewer.resetPasswordDismiss")}
        </button>
      </section>
    );
  }

  if (!open) {
    return (
      <button type="button" className="secondary-button" style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>
        {t("reviewer.resetPasswordTitle")}
      </button>
    );
  }

  return (
    <section className="detail-panel" style={{ marginBottom: 16 }}>
      <h3>{t("reviewer.resetPasswordTitle")}</h3>
      <p>{t("reviewer.resetPasswordHint")}</p>
      <form className="signature-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>{t("reviewer.resetPasswordEmailLabel")}</label>
          <input type="email" value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>{t("signature.passwordLabel")}</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="secondary-button" disabled={submitting || !targetEmail || !password}>
            {submitting ? t("reviewer.resetPasswordBusy") : t("reviewer.resetPasswordButton")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setOpen(false);
              setError("");
            }}
          >
            {t("reviewer.cancel")}
          </button>
        </div>
        {error && <small className="login-error">{error}</small>}
      </form>
    </section>
  );
}

// IT-only: permanently delete ANY account -- another IT reviewer (including
// the acting IT reviewer's own), a plain department reviewer, or File
// Management. No separate object to select first (unlike ReauthConfirmButton
// elsewhere in the app, which confirms an action on something already on
// screen), so this needs its own target-email field, same shape as
// ResetPasswordPanel above. Deleting your own account logs you straight out
// via onSelfDelete instead of showing a dismissible success panel, since
// there'd be nothing left to dismiss back to.
function DeleteAccountPanel({ t, currentUserID, onSelfDelete }) {
  const [open, setOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { data } = await client.post("/auth/delete-account", { userID: targetEmail, password });
      if (data.userID.toLowerCase() === currentUserID.toLowerCase()) {
        onSelfDelete();
        return;
      }
      setResult(data);
      setTargetEmail("");
      setPassword("");
    } catch (err) {
      setError(err.response?.data?.error || t("reviewer.deleteAccountError"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleDismiss() {
    setResult(null);
    setOpen(false);
  }

  if (result) {
    return (
      <section className="detail-panel" style={{ marginBottom: 16 }}>
        <h3>{t("reviewer.deleteAccountSuccessTitle")}</h3>
        <p>{t("reviewer.deleteAccountSuccessHint", { name: result.fullName })}</p>
        <button type="button" className="secondary-button" onClick={handleDismiss}>
          {t("reviewer.resetPasswordDismiss")}
        </button>
      </section>
    );
  }

  if (!open) {
    return (
      <button type="button" className="secondary-button" style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>
        {t("reviewer.deleteAccountTitle")}
      </button>
    );
  }

  return (
    <section className="detail-panel" style={{ marginBottom: 16 }}>
      <h3>{t("reviewer.deleteAccountTitle")}</h3>
      <div className="danger-zone">
        <p>{t("reviewer.deleteAccountHint")}</p>
        <form className="signature-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t("reviewer.resetPasswordEmailLabel")}</label>
            <input type="email" value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>{t("signature.passwordLabel")}</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="secondary-button" disabled={submitting || !targetEmail || !password}>
              {submitting ? t("reviewer.deleteAccountBusy") : t("reviewer.deleteAccountButton")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              {t("reviewer.cancel")}
            </button>
          </div>
          {error && <small className="login-error">{error}</small>}
        </form>
      </div>
    </section>
  );
}

export default function ReviewerDashboard() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [signing, setSigning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  const isOversight = Boolean(user.hasOversightDashboard);
  const isIT = user.departmentKey === "it";

  async function reload(keepId) {
    const { data } = await client.get("/requests", { params: { q: employeeSearch } });
    setRequests(data);
    setLoading(false);
    setSelectedId(keepId && data.some((r) => r._id === keepId) ? keepId : null);
  }

  useEffect(() => {
    reload();
  }, [employeeSearch]);

  const selected = requests.find((r) => r._id === selectedId);
  const myDept = selected?.departments.find((d) => d.departmentKey === user.departmentKey);

  function myDeptOf(r) {
    return r.departments.find((d) => d.departmentKey === user.departmentKey);
  }
  const needsActionList = requests.filter((r) => myDeptOf(r)?.needsAction);
  const handledList = requests.filter((r) => !myDeptOf(r)?.needsAction);

  function isDeptUnlocked(request, dept) {
    if (!dept) return false;
    return request.departments.filter((d) => d.tier < dept.tier).every((d) => d.status === "completed");
  }

  async function handleSign({ itemKey, password, file, notes }) {
    if (!selected || !myDept) return;
    setSigning(true);
    try {
      const form = new FormData();
      form.append("password", password);
      form.append("evidence", file);
      // Only meaningful for wages/finance's single-mode sign (see
      // SignaturePanel.jsx's showNotes) -- itemized item forms never pass
      // this, and the backend ignores it for any department that isn't
      // hasOversightDashboard anyway.
      if (notes) form.append("notes", notes);
      const url = itemKey
        ? `/requests/${selected._id}/departments/${myDept.departmentKey}/items/${itemKey}/sign`
        : `/requests/${selected._id}/departments/${myDept.departmentKey}/sign`;
      await client.post(url, form);
      await reload(selected._id);
    } catch (err) {
      alert(err.response?.data?.error || t("signature.error"));
    } finally {
      setSigning(false);
    }
  }

  // Undo MY OWN just-signed department/item (e.g. uploaded the wrong file by
  // mistake) -- same backend routes as File Management's reopen
  // (POST .../reopen, .../items/:itemKey/reopen), just called with the
  // reviewer's own token instead of File Management's. The backend tells the
  // two apart by role, not this component.
  async function handleUndo({ itemKey, password }) {
    if (!selected || !myDept) return;
    setUndoing(true);
    try {
      const url = itemKey
        ? `/requests/${selected._id}/departments/${myDept.departmentKey}/items/${itemKey}/reopen`
        : `/requests/${selected._id}/departments/${myDept.departmentKey}/reopen`;
      await client.post(url, { password });
      await reload(selected._id);
    } catch (err) {
      throw new Error(err.response?.data?.error || t("signature.error"));
    } finally {
      setUndoing(false);
    }
  }

  async function handleArchive(password) {
    if (!selected) return;
    setArchiving(true);
    try {
      await client.post(`/requests/${selected._id}/revoke-access`, { password });
      await reload(selected._id);
    } catch (err) {
      alert(err.response?.data?.error || t("signature.error"));
    } finally {
      setArchiving(false);
    }
  }

  const isAr = i18n.language === "ar";
  const departmentTitle = isAr ? user.departmentName_ar : user.departmentName_en;
  const displayName = isAr ? user.fullName_ar || user.fullName : user.fullName;

  return (
    <div className="dashboard-page">
      <BusinessDoodleBg />

      <header className="dashboard-header">
        <div className="dashboard-brand">
          <img src={logoUrl} alt={t("common.logoAlt")} />
          <div>
            <strong>{t("appTitle")}</strong>
            <span>{t("common.brandSubtitle")}</span>
          </div>
        </div>

        <div className="employee-summary">
          <p>{t("login.welcome")}</p>
          <h1>{displayName}</h1>
          <span>{departmentTitle}</span>
        </div>

        <div className="head-actions-group">
          <TopBarControls />
          <button className="logout-button" type="button" onClick={logout}>
            {t("nav.logout")}
          </button>
        </div>
      </header>

      <section className="dashboard-content">
        <div className="tabs">
          <button type="button" className="tab-button active">
            {t("reviewer.dashboardTotal")}
          </button>
        </div>

        {!selected && (
          <>
            {isIT && <ResetPasswordPanel t={t} />}
            {isIT && <DeleteAccountPanel t={t} currentUserID={user.userID} onSelfDelete={logout} />}

            {loading && <p className="dashboard-status-message">{t("common.loading")}</p>}

            {!loading && (
              <>
                <DepartmentDashboard requests={requests} user={user} />
                <EmployeeSearchFilter value={employeeSearch} onChange={setEmployeeSearch} />

                {requests.length === 0 && (
                  <p className="dashboard-status-message">{t("reviewer.empty")}</p>
                )}

                {needsActionList.length > 0 && (
                  <section className="requests-section">
                    <div className="requests-heading">
                      <h3>{t("reviewer.sectionNeedsAction")}</h3>
                      <span>{needsActionList.length}</span>
                    </div>
                    <RequestTable requests={needsActionList} getDept={myDeptOf} t={t}
                      lang={i18n.language} onOpen={setSelectedId} showArchivedMarker={isIT} />
                  </section>
                )}

                {handledList.length > 0 && (
                  <section className="requests-section">
                    <div className="requests-heading">
                      <h3>{t("reviewer.sectionHandled")}</h3>
                      <span>{handledList.length}</span>
                    </div>
                    <RequestTable requests={handledList} getDept={myDeptOf} t={t}
                      lang={i18n.language} onOpen={setSelectedId} showArchivedMarker={isIT} />
                  </section>
                )}
              </>
            )}
          </>
        )}

        {selected && (
          <>
            <button className="secondary-button" onClick={() => setSelectedId(null)}>
              &larr; {t("reviewer.backToList")}
            </button>

            <section className="detail-panel" style={{ marginTop: 16 }}>
              <h3>{selected.employeeFullName}</h3>

              <div className="detail-row">
                <span>{t("fileManagement.jobTitleLabel")}</span>
                <strong>{selected.employeeJobTitle || "—"}</strong>
              </div>
              <div className="detail-row">
                <span>{t("reviewer.requestInfoDepartment")}</span>
                <strong>{isAr ? selected.employeeDepartment_ar : selected.employeeDepartment_en}</strong>
              </div>
              <div className="detail-row">
                <span>{t("reviewer.requestInfoReason")}</span>
                <strong>{t(`employee.${reasonI18nKey(selected.reason)}`)}</strong>
              </div>
              <div className="detail-row">
                <span>{t("reviewer.requestInfoLastDay")}</span>
                <strong>{formatDate(selected.lastWorkingDay, i18n.language)}</strong>
              </div>
              <div className="detail-row">
                <span>{t("reviewer.requestInfoSubmitted")}</span>
                <strong>{formatDate(selected.createdAt, i18n.language)}</strong>
              </div>

              {isOversight && <RequestOversightGrid request={selected} />}

              {myDept &&
                (isDeptUnlocked(selected, myDept) ? (
                  <SignaturePanel
                    department={myDept}
                    user={user}
                    onSign={handleSign}
                    busy={signing}
                    onUndo={!selected.accessRevoked ? handleUndo : undefined}
                    requestId={selected._id}
                  />
                ) : (
                  <p className="locked-banner">
                    <strong>{t("reviewer.departmentLockedTitle")}</strong> — {t("reviewer.departmentLockedBody")}
                  </p>
                ))}

              {isIT &&
                (selected.accessRevoked ? (
                  <div className="success-banner">
                    <strong>{t("reviewer.accessRevokedBanner")}</strong>
                  </div>
                ) : (
                  // NOT selected.status === "completed" -- per the general
                  // rule, the request only reads as "completed" once IT has
                  // actually revoked the employee's access, which would make
                  // this button impossible to ever reach. `readyForAccessRevocation`
                  // now requires every department signed AND File
                  // Management's explicit approval (see request.routes.js).
                  selected.readyForAccessRevocation ? (
                    <RevokeAccessForm onSubmit={handleArchive} busy={archiving} t={t} />
                  ) : (
                    // Distinguishes "not everyone's signed yet" (no note --
                    // IT just sees the locked/awaiting state above) from
                    // "signed, but File Management hasn't reviewed it yet" --
                    // without this IT has no way to tell those apart, since
                    // they never see other departments' status.
                    selected.awaitingFileManagementApproval && (
                      <p className="locked-banner">
                        <strong>{t("reviewer.awaitingFileManagementApprovalTitle")}</strong> —{" "}
                        {t("reviewer.awaitingFileManagementApprovalBody")}
                      </p>
                    )
                  )
                ))}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
