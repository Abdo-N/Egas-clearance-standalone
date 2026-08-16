import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import TopBarControls from "../components/TopBarControls";
import BusinessDoodleBg from "../components/BusinessDoodleBg";
import RequestOversightGrid from "../components/RequestOversightGrid";
import DepartmentDashboard from "../components/DepartmentDashboard";
import EmployeeSearchFilter from "../components/EmployeeSearchFilter";
import SortableTableHeader, { isRequestOlderThanSevenDays, nextSort, sortTableRows } from "../components/SortableTableHeader";
import PasswordInput from "../components/PasswordInput";
import ReauthConfirmButton from "../components/ReauthConfirmButton";
import { formatDate } from "../utils/formatDate";
import { REASONS, reasonI18nKey } from "../utils/leavingReason";
import { JOB_TITLES } from "../jobTitles";
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
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [requestSort, setRequestSort] = useState({ key: null, direction: null });

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

  async function loadRequests() {
    const { data } = await client.get("/requests", { params: { q: employeeSearch } });
    setRequests(data);
    setLoading(false);
  }

  useEffect(() => {
    loadRequests();
  }, [employeeSearch]);

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
      toast.success(t("fileManagement.submitSuccessToast"));
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
      toast.error(t("fileManagement.pdfError"));
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleReopenDepartment(requestId, deptKey, password) {
    try {
      await client.post(`/requests/${requestId}/departments/${deptKey}/reopen`, { password });
      await loadRequests();
      toast.success(t("fileManagement.reopenSuccessToast"));
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.reopenError"));
    }
  }

  async function handleReopenItem(requestId, deptKey, itemKey, password) {
    try {
      await client.post(`/requests/${requestId}/departments/${deptKey}/items/${itemKey}/reopen`, { password });
      await loadRequests();
      toast.success(t("fileManagement.reopenSuccessToast"));
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.reopenError"));
    }
  }

  async function handleApprove(requestId, password) {
    try {
      await client.post(`/requests/${requestId}/approve-clearance`, { password });
      await loadRequests();
      toast.success(t("fileManagement.approveSuccessToast"));
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.approveError"));
    }
  }

  // Permanent, unrecoverable -- e.g. the employee came back to the company
  // after already being cleared. Only reachable once the request is fully
  // completed (see the `selected.status === "completed"` gate below and
  // POST /:id/delete in request.routes.js) -- reverts a finalized clearance,
  // not a general "cancel any request" tool.
  async function handleDelete(requestId, password) {
    try {
      await client.post(`/requests/${requestId}/delete`, { password });
      setExpandedId(null);
      await loadRequests();
      toast.success(t("fileManagement.deleteSuccessToast"));
    } catch (err) {
      throw new Error(err.response?.data?.error || t("fileManagement.deleteError"));
    }
  }

  const selected = requests.find((r) => r._id === expandedId);
  const sortedRequests = sortTableRows(requests, requestSort, {
    employee: (request) => request.employeeFullName,
    jobTitle: (request) => request.employeeJobTitle,
    department: (request) => (i18n.language === "ar" ? request.employeeDepartment_ar : request.employeeDepartment_en),
    reason: (request) => t(`employee.${reasonI18nKey(request.reason)}`),
    lastWorkingDay: (request) => new Date(request.lastWorkingDay).getTime(),
    status: (request) => {
      const modifier = requestStatusPill(request, t).modifier;
      if (modifier === "pending") return 3;
      if (modifier === "awaiting") return 2;
      return 1;
    },
    submittedOn: (request) => new Date(request.createdAt).getTime(),
  }, i18n.language);
  const handleRequestSort = (key) => setRequestSort((current) => nextSort(current, key));
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
            <form className="request-create-form" onSubmit={handleSubmit}>
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
                  list="jobTitlesList"
                  autoComplete="off"
                  value={employeeJobTitle}
                  onChange={(e) => setEmployeeJobTitle(e.target.value)}
                />
                <datalist id="jobTitlesList">
                  {JOB_TITLES.map((title) => (
                    <option key={title} value={title} />
                  ))}
                </datalist>
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
                <label htmlFor="reason">{t("employee.reasonLabel")}</label>
                <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
                  <option value="">{t("employee.reasonPlaceholder")}</option>
                  {REASONS.map((value) => (
                    <option key={value} value={value}>
                      {t(`employee.${reasonI18nKey(value)}`)}
                    </option>
                  ))}
                </select>
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
            {!selected ? (
              <>
                <EmployeeSearchFilter value={employeeSearch} onChange={setEmployeeSearch} />

                {loading && <p className="dashboard-status-message">{t("common.loading")}</p>}
                {!loading && requests.length === 0 && (
                  <p className="dashboard-status-message">{t("fileManagement.empty")}</p>
                )}

                {!loading && requests.length > 0 && (
                  <div className="admin-table-wrapper">
                    <table className="admin-table">
                  <thead>
                    <tr>
                      <SortableTableHeader columnKey="employee" label={t("reviewer.employee")} sort={requestSort} onSort={handleRequestSort} />
                      <SortableTableHeader columnKey="jobTitle" label={t("fileManagement.jobTitleLabel")} sort={requestSort} onSort={handleRequestSort} />
                      <SortableTableHeader columnKey="department" label={t("reviewer.requestInfoDepartment")} sort={requestSort} onSort={handleRequestSort} />
                      <SortableTableHeader columnKey="reason" label={t("employee.reasonLabel")} sort={requestSort} onSort={handleRequestSort} />
                      <SortableTableHeader columnKey="lastWorkingDay" label={t("employee.lastWorkingDayLabel")} sort={requestSort} onSort={handleRequestSort} />
                      <SortableTableHeader columnKey="status" label={t("employee.statusLabel")} sort={requestSort} onSort={handleRequestSort} />
                      <SortableTableHeader columnKey="submittedOn" label={t("employee.requestedOn")} sort={requestSort} onSort={handleRequestSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRequests.map((r) => {
                      const pill = requestStatusPill(r, t);
                      const overdue = pill.modifier !== "completed" && isRequestOlderThanSevenDays(r);
                      return (
                        <tr
                          key={r._id}
                          className={expandedId === r._id ? "is-selected" : ""}
                          tabIndex={0}
                          onClick={() => setExpandedId(r._id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setExpandedId(r._id);
                            }
                          }}
                        >
                          <td>
                            {r.employeeFullName} <small>#{r.employeeNumber}</small>
                          </td>
                          <td>{r.employeeJobTitle || "—"}</td>
                          <td>{(i18n.language === "ar" ? r.employeeDepartment_ar : r.employeeDepartment_en) || "—"}</td>
                          <td>{t(`employee.${reasonI18nKey(r.reason)}`)}</td>
                          <td>{formatDate(r.lastWorkingDay, i18n.language)}</td>
                          <td>
                            <span className="status-pill-group">
                              <span className={`status-pill ${pill.modifier}`}>{pill.label}</span>
                              {overdue && <span className="status-pill status-pill--overdue">{t("common.overdueBadge")}</span>}
                            </span>
                          </td>
                          <td>{formatDate(r.createdAt, i18n.language)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <button className="secondary-button detail-back-button" type="button" onClick={() => setExpandedId(null)}>
                  <span aria-hidden="true">{i18n.language === "ar" ? "→" : "←"}</span>
                  {t("reviewer.backToList")}
                </button>
                <section className="detail-panel">
                <h3>
                  {selected.employeeFullName} · #{selected.employeeNumber}
                </h3>

                <div className="detail-row">
                  <span>{t("fileManagement.jobTitleLabel")}</span>
                  <strong>{selected.employeeJobTitle || "—"}</strong>
                </div>
                <div className="detail-row">
                  <span>{t("reviewer.requestInfoDepartment")}</span>
                  <strong>{(i18n.language === "ar" ? selected.employeeDepartment_ar : selected.employeeDepartment_en) || "—"}</strong>
                </div>
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
                    className="secondary-button fm-pdf-button"
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

                {selected.status === "completed" && (
                  <div className="danger-zone">
                    <p>{t("fileManagement.deleteHint")}</p>
                    <ReauthConfirmButton
                      openLabel={t("fileManagement.deleteButton")}
                      confirmLabel={t("fileManagement.confirmDelete")}
                      busyLabel={t("fileManagement.deleting")}
                      cancelLabel={t("fileManagement.cancel")}
                      errorFallback={t("fileManagement.deleteError")}
                      onConfirm={(password) => handleDelete(selected._id, password)}
                    />
                  </div>
                )}
                </section>
              </>
            )}
          </>
        )}

        {tab === "analytics" && !loading && <DepartmentDashboard requests={requests} user={user} />}
      </section>
    </div>
  );
}
