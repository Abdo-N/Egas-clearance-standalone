import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import TopBarControls from "../components/TopBarControls";
import BusinessDoodleBg from "../components/BusinessDoodleBg";
import PasswordInput from "../components/PasswordInput";
import ReauthConfirmButton from "../components/ReauthConfirmButton";
import logoUrl from "../assets/egas-logo.png";

// Mirrors backend/src/utils/passwordPolicy.js -- same duplication pattern as
// every other password field in this app (Register.jsx used to, now
// SetNewPassword.jsx and this page do).
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

function isPasswordStrongEnough(password) {
  return password.length >= PASSWORD_MIN_LENGTH && PASSWORD_SYMBOL_PATTERN.test(password);
}

// Shared by the accounts table (existing accounts) and the create-account
// role dropdown (roles the acting user is allowed to create) -- see
// MANAGEABLE_ROLES_BY_ACTOR in auth.routes.js for which roles an admin vs a
// super_admin can actually see/manage; this is purely the display label.
function roleDisplayLabel(role, t) {
  if (role === "super_admin") return t("admin.roleSuperAdmin");
  if (role === "admin") return t("admin.roleAdmin");
  if (role === "file_management") return t("admin.roleFileManagement");
  return t("admin.roleReviewer");
}

function roleLabel(account, t) {
  return roleDisplayLabel(account.role, t);
}

// Account creation replaces self-registration entirely (see CLAUDE.md
// "Account provisioning is admin-managed, no sign-up") -- every field here
// mirrors what the old Register.jsx form collected from the person
// themselves, now typed in by an admin instead, plus the admin's own
// password for re-auth (same pattern as every other consequential action in
// this app).
function CreateAccountForm({ departments, manageableRoles, onCreate, t, isAr }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [landlineNumber, setLandlineNumber] = useState("");
  const [role, setRole] = useState(manageableRoles[0]);
  const [departmentKey, setDepartmentKey] = useState("");
  const [assignedItemKey, setAssignedItemKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);

  const selectedDepartment = departments.find((d) => d.key === departmentKey);
  const isItemized = selectedDepartment?.signatureMode === "itemized";

  function resetForm() {
    setCurrentPassword("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setLandlineNumber("");
    setRole(manageableRoles[0]);
    setDepartmentKey("");
    setAssignedItemKey("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("passwordRules.mismatch"));
      return;
    }
    if (!isPasswordStrongEnough(password)) {
      setError(t("passwordRules.tooWeak"));
      return;
    }

    setSubmitting(true);
    try {
      const account = await onCreate({
        currentPassword,
        email,
        password,
        fullName,
        landlineNumber,
        role,
        departmentKey: role === "reviewer" ? departmentKey : undefined,
        assignedItemKey: role === "reviewer" && isItemized ? assignedItemKey : undefined,
      });
      setCreated(account);
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error || t("admin.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <section className="detail-panel">
        <h3>{t("admin.createdTitle")}</h3>
        <p>{t("admin.createdHint", { name: created.fullName })}</p>
        <button type="button" className="secondary-button" onClick={() => setCreated(null)}>
          {t("admin.dismiss")}
        </button>
      </section>
    );
  }

  return (
    <section className="new-request-card">
      <h2>{t("admin.createTitle")}</h2>
      <form className="request-create-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>{t("admin.yourPasswordLabel")}</label>
          <PasswordInput
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <div className="form-group">
          <label>{t("admin.fullNameLabel")}</label>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>{t("admin.landlineNumberLabel")}</label>
          <input type="tel" value={landlineNumber} onChange={(e) => setLandlineNumber(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>{t("admin.emailLabel")}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>{t("admin.newPasswordLabel")}</label>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          <small style={{ color: password && !isPasswordStrongEnough(password) ? "#d93025" : "var(--muted, #888)" }}>
            {t("passwordRules.hint")}
          </small>
        </div>

        <div className="form-group">
          <label>{t("passwordRules.confirmLabel")}</label>
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        {manageableRoles.length > 1 && (
          <div className="form-group">
            <label>{t("admin.roleLabel")}</label>
            <select value={role} onChange={(e) => { setRole(e.target.value); setDepartmentKey(""); setAssignedItemKey(""); }}>
              {manageableRoles.map((r) => (
                <option key={r} value={r}>{roleDisplayLabel(r, t)}</option>
              ))}
            </select>
          </div>
        )}

        {role === "reviewer" && (
          <div className="form-group">
            <label>{t("admin.departmentLabel")}</label>
            <select
              value={departmentKey}
              onChange={(e) => {
                setDepartmentKey(e.target.value);
                setAssignedItemKey("");
              }}
              required
            >
              <option value="">{t("admin.departmentPlaceholder")}</option>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {isAr ? d.name_ar : d.name_en}
                </option>
              ))}
            </select>
          </div>
        )}

        {role === "reviewer" && isItemized && (
          <div className="form-group">
            <label>{t("admin.itemLabel")}</label>
            <select value={assignedItemKey} onChange={(e) => setAssignedItemKey(e.target.value)} required>
              <option value="">{t("admin.itemPlaceholder")}</option>
              {selectedDepartment.checklistItems.map((item) => (
                <option key={item.key} value={item.key}>
                  {isAr ? item.label_ar : item.label_en}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="secondary-button" disabled={submitting}>
          {submitting ? t("admin.submitting") : t("admin.submit")}
        </button>
      </form>
    </section>
  );
}

function AccountRow({ account, currentUserID, departmentsByKey, isAr, onReset, onDelete, t }) {
  const isSelf = account.userID.toLowerCase() === currentUserID.toLowerCase();
  const department = account.departmentKey ? departmentsByKey.get(account.departmentKey) : null;
  const departmentDisplay = department ? (isAr ? department.name_ar : department.name_en) : "—";

  return (
    <tr>
      <td>{account.fullName_ar || account.fullName} {isSelf && <small>{t("admin.you")}</small>}</td>
      <td>{account.userID}</td>
      <td>{roleLabel(account, t)}</td>
      <td>{departmentDisplay}</td>
      <td>{account.landlineNumber || "—"}</td>
      <td>
        <span className={`status-pill ${account.mustResetPassword ? "pending" : "completed"}`}>
          {account.mustResetPassword ? t("admin.statusMustReset") : t("admin.statusActive")}
        </span>
      </td>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <ReauthConfirmButton
            openLabel={t("admin.resetPasswordButton")}
            confirmLabel={t("admin.resetPasswordButton")}
            busyLabel={t("admin.resetPasswordBusy")}
            cancelLabel={t("admin.cancel")}
            errorFallback={t("admin.resetPasswordError")}
            onConfirm={(password) => onReset(account, password)}
          />
          <ReauthConfirmButton
            openLabel={t("admin.deleteButton")}
            confirmLabel={t("admin.deleteButton")}
            busyLabel={t("admin.resetPasswordBusy")}
            cancelLabel={t("admin.cancel")}
            errorFallback={t("admin.deleteError")}
            onConfirm={(password) => onDelete(account, password)}
          />
        </div>
      </td>
    </tr>
  );
}

export default function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastReset, setLastReset] = useState(null);
  const [copied, setCopied] = useState(false);

  async function reload() {
    const [{ data: accountsData }, { data: departmentsData }] = await Promise.all([
      client.get("/auth/accounts"),
      client.get("/departments"),
    ]);
    setAccounts(accountsData);
    setDepartments(departmentsData);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate(payload) {
    const { data } = await client.post("/auth/accounts", payload);
    await reload();
    return data;
  }

  async function handleReset(account, password) {
    try {
      const { data } = await client.post("/auth/reset-password", { userID: account.userID, password });
      setLastReset(data);
      setCopied(false);
      await reload();
    } catch (err) {
      throw new Error(err.response?.data?.error || t("admin.resetPasswordError"));
    }
  }

  async function handleDelete(account, password) {
    try {
      await client.post("/auth/delete-account", { userID: account.userID, password });
    } catch (err) {
      throw new Error(err.response?.data?.error || t("admin.deleteError"));
    }
    if (account.userID.toLowerCase() === user.userID.toLowerCase()) {
      logout();
      return;
    }
    await reload();
  }

  function handleCopy() {
    navigator.clipboard?.writeText(lastReset.oneTimePassword);
    setCopied(true);
  }

  const displayName = isAr ? user.fullName_ar || user.fullName : user.fullName;
  const departmentsByKey = new Map(departments.map((d) => [d.key, d]));
  // Mirrors MANAGEABLE_ROLES_BY_ACTOR in auth.routes.js -- this same
  // component renders both /admin (manages File Management/reviewer
  // accounts) and /super-admin (manages ONLY admin accounts -- there is
  // exactly one super_admin ever, so it can never create another); the
  // backend is the real enforcement, this just keeps the form from ever
  // offering a role the actor isn't allowed to create.
  const manageableRoles = user.role === "super_admin" ? ["admin"] : ["file_management", "reviewer"];

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
          <span>{t(user.role === "super_admin" ? "admin.titleSuperAdmin" : "admin.titleAdmin")}</span>
        </div>

        <div className="head-actions-group">
          <TopBarControls />
          <button className="logout-button" type="button" onClick={logout}>
            {t("nav.logout")}
          </button>
        </div>
      </header>

      <section className="dashboard-content">
        {loading && <p className="dashboard-status-message">{t("common.loading")}</p>}

        {!loading && (
          <>
            <CreateAccountForm departments={departments} manageableRoles={manageableRoles} onCreate={handleCreate} t={t} isAr={isAr} />

            {lastReset && (
              <section className="detail-panel" style={{ marginTop: 16 }}>
                <h3>{t("admin.resetPasswordSuccessTitle")}</h3>
                <p>{t("admin.resetPasswordSuccessHint", { name: lastReset.fullName })}</p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    margin: "10px 0",
                    borderRadius: 8,
                    background: "var(--card, #f4f5f6)",
                    border: "1px dashed var(--line, #d1d5db)",
                  }}
                >
                  <code style={{ fontSize: 16, letterSpacing: 1 }}>{lastReset.oneTimePassword}</code>
                  <button type="button" className="secondary-button" onClick={handleCopy}>
                    {copied ? t("admin.resetPasswordCopied") : t("admin.resetPasswordCopy")}
                  </button>
                </div>
                <button type="button" className="secondary-button" onClick={() => setLastReset(null)}>
                  {t("admin.dismiss")}
                </button>
              </section>
            )}

            <section className="requests-section" style={{ marginTop: 16 }}>
              <div className="requests-heading">
                <h3>{t("admin.accountsTitle")}</h3>
                <span>{accounts.length}</span>
              </div>

              {accounts.length === 0 ? (
                <p className="dashboard-status-message">{t("admin.accountsEmpty")}</p>
              ) : (
                <div className="admin-table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("admin.colName")}</th>
                        <th>{t("admin.colEmail")}</th>
                        <th>{t("admin.colRole")}</th>
                        <th>{t("admin.colDepartment")}</th>
                        <th>{t("admin.colLandline")}</th>
                        <th>{t("admin.colStatus")}</th>
                        <th>{t("admin.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((account) => (
                        <AccountRow
                          key={account.userID}
                          account={account}
                          currentUserID={user.userID}
                          departmentsByKey={departmentsByKey}
                          isAr={isAr}
                          onReset={handleReset}
                          onDelete={handleDelete}
                          t={t}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
