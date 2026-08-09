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
import DateRangeFilter from "../components/DateRangeFilter";
import { formatDate } from "../utils/formatDate";
import { reasonI18nKey } from "../utils/leavingReason";
import logoUrl from "../assets/egas-logo.png";

// One card in the request grid -- shows enough for a reviewer to triage
// without opening it (reason, last working day, status), not just a bare
// employee name.
function RequestCard({ request, dept, t, lang, onOpen, showArchivedMarker }) {
  return (
    <article className="request-card">
      <div className="request-card-top" style={{ justifyContent: "flex-end" }}>
        {showArchivedMarker && request.accessRevoked && (
          <span className="status-pill archived">{t("common.accessRevokedBadge")}</span>
        )}
        <span className={`status-pill ${dept?.status === "completed" ? "completed" : "pending"}`}>
          {dept?.status === "completed" ? t("employee.departmentCompleted") : t("employee.departmentPending")}
        </span>
      </div>

      <div className="request-employee">
        <div className="employee-avatar">{request.employeeFullName.charAt(0)}</div>
        <div>
          <h4>{request.employeeFullName}</h4>
          <p>
            {t(`employee.${reasonI18nKey(request.reason)}`)} · {formatDate(request.lastWorkingDay, lang)}
          </p>
        </div>
      </div>

      <div className="request-actions">
        <button className="secondary-button" style={{ flex: 1 }} type="button" onClick={() => onOpen(request._id)}>
          {t("reviewer.open")}
        </button>
      </div>
    </article>
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

export default function ReviewerDashboard() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [signing, setSigning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const isOversight = Boolean(user.hasOversightDashboard);
  const isIT = user.departmentKey === "it";

  async function reload(keepId) {
    const { data } = await client.get("/requests", { params: { from: dateFrom, to: dateTo } });
    setRequests(data);
    setLoading(false);
    setSelectedId(keepId && data.some((r) => r._id === keepId) ? keepId : null);
  }

  useEffect(() => {
    reload();
  }, [dateFrom, dateTo]);

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

  async function handleSign({ itemKey, password, file }) {
    if (!selected || !myDept) return;
    setSigning(true);
    try {
      const form = new FormData();
      form.append("password", password);
      form.append("evidence", file);
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
            <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />

            {loading && <p className="dashboard-status-message">{t("common.loading")}</p>}
            {!loading && requests.length === 0 && (
              <p className="dashboard-status-message">{t("reviewer.empty")}</p>
            )}

            {!loading && requests.length > 0 && (
              <>
                <DepartmentDashboard requests={requests} user={user} />

                {needsActionList.length > 0 && (
                  <section className="requests-section">
                    <div className="requests-heading">
                      <h3>{t("reviewer.sectionNeedsAction")}</h3>
                      <span>{needsActionList.length}</span>
                    </div>
                    <div className="requests-grid">
                      {needsActionList.map((r) => (
                        <RequestCard
                          key={r._id}
                          request={r}
                          dept={myDeptOf(r)}
                          t={t}
                          lang={i18n.language}
                          onOpen={setSelectedId}
                          showArchivedMarker={isIT}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {handledList.length > 0 && (
                  <section className="requests-section">
                    <div className="requests-heading">
                      <h3>{t("reviewer.sectionHandled")}</h3>
                      <span>{handledList.length}</span>
                    </div>
                    <div className="requests-grid">
                      {handledList.map((r) => (
                        <RequestCard
                          key={r._id}
                          request={r}
                          dept={myDeptOf(r)}
                          t={t}
                          lang={i18n.language}
                          onOpen={setSelectedId}
                          showArchivedMarker={isIT}
                        />
                      ))}
                    </div>
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

              {isOversight && <RequestOversightGrid request={selected} detail="full" />}

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
