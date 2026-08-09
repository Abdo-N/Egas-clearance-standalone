import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import TopBarControls from "../components/TopBarControls";
import BusinessDoodleBg from "../components/BusinessDoodleBg";
import RequestOversightGrid from "../components/RequestOversightGrid";
import DepartmentDashboard from "../components/DepartmentDashboard";
import DateRangeFilter from "../components/DateRangeFilter";
import PasswordInput from "../components/PasswordInput";
import { formatDate } from "../utils/formatDate";
import { REASONS, reasonI18nKey } from "../utils/leavingReason";
import logoUrl from "../assets/egas-logo.png";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// Every one of the 13 departments has signed -- doesn't mean approved or
// archived yet, just that there's nothing left to reopen except in response
// to a legibility problem. Derived from the summary departments array (each
// entry only carries `status`, matching File Management's high-level view).
function isFullySigned(request) {
  return request.departments.every((d) => d.status === "completed");
}

// What the request-list table's status pill shows -- mirrors the same
// completed/awaiting/pending precedence used everywhere else on this page.
function requestStatusPill(r, t) {
  if (r.status === "completed") return { modifier: "completed", label: t("employee.statusCompleted") };
  if (r.readyForAccessRevocation) return { modifier: "awaiting", label: t("common.awaitingAccessRevocationBadge") };
  if (r.awaitingFileManagementApproval) return { modifier: "awaiting", label: t("common.awaitingApprovalBadge") };
  return { modifier: "pending", label: t("employee.statusInProgress") };
}

// File Management's explicit "I reviewed the signed form, it's OK" gate --
// same re-authentication pattern as signing/revoke-access. Only shown once
// every department has signed and only until it's given (see
// awaitingFileManagementApproval on the request).
function ApproveControl({ onConfirm, t }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(password);
      setPassword("");
    } catch (err) {
      setError(err.message || t("fileManagement.approveError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="signature-form" onSubmit={handleSubmit}>
      <p>{t("fileManagement.approveHint")}</p>
      <div className="form-group">
        <label>{t("signature.passwordLabel")}</label>
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" className="primary-button" disabled={submitting || !password}>
        {submitting ? t("fileManagement.approving") : t("fileManagement.approveButton")}
      </button>
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}

export default function FileManagementDashboard() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("create");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [employeeFullName, setEmployeeFullName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [employeeJobTitle, setEmployeeJobTitle] = useState("");
  const [departments, setDepartments] = useState([]);
  const [employeeDepartmentKey, setEmployeeDepartmentKey] = useState("");
  const [employeeDepartmentAr, setEmployeeDepartmentAr] = useState("");
  const [employeeDepartmentEn, setEmployeeDepartmentEn] = useState("");
  const [reason, setReason] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  async function loadRequests() {
    const { data } = await client.get("/requests", { params: { from: dateFrom, to: dateTo } });
    setRequests(data);
    setLoading(false);
  }

  useEffect(() => {
    loadRequests();
  }, [dateFrom, dateTo]);

  useEffect(() => {
    client.get("/departments").then(({ data }) => setDepartments(data));
  }, []);

  function handleDepartmentChange(key) {
    setEmployeeDepartmentKey(key);
    const dept = departments.find((d) => d.key === key);
    setEmployeeDepartmentAr(dept?.name_ar || "");
    setEmployeeDepartmentEn(dept?.name_en || "");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setSubmitSuccess("");
    setSubmitting(true);
    try {
      await client.post("/requests", {
        employeeFullName,
        employeeNumber,
        employeeJobTitle,
        employeeDepartment_ar: employeeDepartmentAr,
        employeeDepartment_en: employeeDepartmentEn,
        reason,
        lastWorkingDay,
      });
      setSubmitSuccess(t("fileManagement.submitButton"));
      setEmployeeFullName("");
      setEmployeeNumber("");
      setEmployeeJobTitle("");
      setEmployeeDepartmentKey("");
      setEmployeeDepartmentAr("");
      setEmployeeDepartmentEn("");
      setReason("");
      setLastWorkingDay("");
      await loadRequests();
    } catch (err) {
      setSubmitError(err.response?.data?.error || t("fileManagement.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadPdf(requestId) {
    setDownloadingId(requestId);
    try {
      const { data } = await client.get(`/requests/${requestId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
    } catch {
      alert(t("fileManagement.pdfError"));
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleReopenDepartment(requestId, deptKey, password) {
    try {
      await client.post(`/requests/${requestId}/departments/${deptKey}/reopen`, { password });
      await loadRequests();
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.reopenError"));
    }
  }

  async function handleReopenItem(requestId, deptKey, itemKey, password) {
    try {
      await client.post(`/requests/${requestId}/departments/${deptKey}/items/${itemKey}/reopen`, { password });
      await loadRequests();
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.reopenError"));
    }
  }

  async function handleApprove(requestId, password) {
    try {
      await client.post(`/requests/${requestId}/approve-clearance`, { password });
      await loadRequests();
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.approveError"));
    }
  }

  const selected = requests.find((r) => r._id === expandedId);
  const displayName = i18n.language === "ar" ? user?.fullName_ar || user?.fullName : user?.fullName;

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
          <span>{t("fileManagement.title")}</span>
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
          <button
            type="button"
            className={tab === "create" ? "tab-button active" : "tab-button"}
            onClick={() => setTab("create")}
          >
            {t("fileManagement.newRequestTitle")}
          </button>
          <button
            type="button"
            className={tab === "list" ? "tab-button active" : "tab-button"}
            onClick={() => setTab("list")}
          >
            {t("fileManagement.myRequestsTitle")}
          </button>
          <button
            type="button"
            className={tab === "analytics" ? "tab-button active" : "tab-button"}
            onClick={() => setTab("analytics")}
          >
            {t("reviewer.dashboardTotal")}
          </button>
        </div>

        {tab === "create" && (
          <section className="new-request-card">
            <h2>{t("fileManagement.newRequestTitle")}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="employeeFullName">{t("fileManagement.fullNameLabel")}</label>
                <input
                  id="employeeFullName"
                  type="text"
                  value={employeeFullName}
                  onChange={(e) => setEmployeeFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="employeeNumber">{t("fileManagement.employeeNumberLabel")}</label>
                <input
                  id="employeeNumber"
                  type="text"
                  value={employeeNumber}
                  onChange={(e) => setEmployeeNumber(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="employeeJobTitle">{t("fileManagement.jobTitleLabel")}</label>
                <input
                  id="employeeJobTitle"
                  type="text"
                  value={employeeJobTitle}
                  onChange={(e) => setEmployeeJobTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="employeeDepartment">{t("fileManagement.departmentLabel")}</label>
                <select
                  id="employeeDepartment"
                  value={employeeDepartmentKey}
                  onChange={(e) => handleDepartmentChange(e.target.value)}
                  required
                >
                  <option value="">{t("fileManagement.departmentPlaceholder")}</option>
                  {departments.map((d) => (
                    <option key={d.key} value={d.key}>
                      {i18n.language === "ar" ? d.name_ar : d.name_en}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{t("employee.reasonLabel")}</label>
                <div className="reason-options">
                  {REASONS.map((value) => (
                    <label className="reason-option" key={value}>
                      <input
                        type="radio"
                        name="reason"
                        value={value}
                        checked={reason === value}
                        onChange={(e) => setReason(e.target.value)}
                        required
                      />
                      {t(`employee.${reasonI18nKey(value)}`)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="lastWorkingDay">{t("employee.lastWorkingDayLabel")}</label>
                <input
                  id="lastWorkingDay"
                  type="date"
                  min={todayIsoDate()}
                  value={lastWorkingDay}
                  onChange={(e) => setLastWorkingDay(e.target.value)}
                  required
                />
              </div>

              {submitError && <p className="form-error">{submitError}</p>}
              {submitSuccess && <p className="employee-lookup-message success">{submitSuccess}</p>}

              <button
                type="submit"
                className="approve-button"
                disabled={submitting || !employeeFullName.trim() || !employeeNumber.trim()}
              >
                {submitting ? t("employee.submitting") : t("fileManagement.submitButton")}
              </button>
            </form>
          </section>
        )}

        {tab === "list" && (
          <>
            <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />

            {loading && <p className="dashboard-status-message">{t("common.loading")}</p>}
            {!loading && requests.length === 0 && (
              <p className="dashboard-status-message">{t("fileManagement.empty")}</p>
            )}

            {!loading && requests.length > 0 && (
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t("reviewer.employee")}</th>
                      <th>{t("employee.reasonLabel")}</th>
                      <th>{t("employee.lastWorkingDayLabel")}</th>
                      <th>{t("employee.statusLabel")}</th>
                      <th>{t("employee.requestedOn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => {
                      const pill = requestStatusPill(r, t);
                      return (
                        <tr key={r._id} onClick={() => setExpandedId(expandedId === r._id ? null : r._id)}>
                          <td>
                            {r.employeeFullName} <small>#{r.employeeNumber}</small>
                          </td>
                          <td>{t(`employee.${reasonI18nKey(r.reason)}`)}</td>
                          <td>{formatDate(r.lastWorkingDay, i18n.language)}</td>
                          <td>
                            <span className={`status-pill ${pill.modifier}`}>{pill.label}</span>
                          </td>
                          <td>{formatDate(r.createdAt, i18n.language)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected && (
              <section className="detail-panel">
                <h3>
                  {selected.employeeFullName} · #{selected.employeeNumber}
                </h3>

                <div className="detail-row">
                  <span>{t("employee.reasonLabel")}</span>
                  <strong>{t(`employee.${reasonI18nKey(selected.reason)}`)}</strong>
                </div>
                <div className="detail-row">
                  <span>{t("employee.lastWorkingDayLabel")}</span>
                  <strong>{formatDate(selected.lastWorkingDay, i18n.language)}</strong>
                </div>
                <div className="detail-row">
                  <span>{t("employee.requestedOn")}</span>
                  <strong>{formatDate(selected.createdAt, i18n.language)}</strong>
                </div>

                <RequestOversightGrid
                  request={selected}
                  detail="summary"
                  onReopenDepartment={
                    !selected.accessRevoked
                      ? (deptKey, password) => handleReopenDepartment(selected._id, deptKey, password)
                      : undefined
                  }
                  onReopenItem={
                    !selected.accessRevoked
                      ? (deptKey, itemKey, password) => handleReopenItem(selected._id, deptKey, itemKey, password)
                      : undefined
                  }
                />

                {selected.awaitingFileManagementApproval && (
                  <ApproveControl t={t} onConfirm={(password) => handleApprove(selected._id, password)} />
                )}
                {selected.readyForAccessRevocation && !selected.accessRevoked && (
                  <div className="success-banner">
                    <strong>{t("fileManagement.approvedNote")}</strong>
                  </div>
                )}

                {isFullySigned(selected) && (
                  <button
                    className="login-button"
                    type="button"
                    disabled={downloadingId === selected._id}
                    onClick={() => handleDownloadPdf(selected._id)}
                  >
                    {downloadingId === selected._id
                      ? t("common.loading")
                      : selected.status === "completed"
                      ? t("fileManagement.downloadPdf")
                      : t("fileManagement.previewPdf")}
                  </button>
                )}
              </section>
            )}
          </>
        )}

        {tab === "analytics" && !loading && <DepartmentDashboard requests={requests} user={user} />}
      </section>
    </div>
  );
}
