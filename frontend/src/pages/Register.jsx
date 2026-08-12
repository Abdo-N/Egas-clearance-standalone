import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import SupportModal from "../components/SupportModal";
import LanguageToggle from "../components/LanguageToggle";
import PasswordInput from "../components/PasswordInput";
import SetupCoverageWarning from "../components/SetupCoverageWarning";
import logoUrl from "../assets/egas-logo.png";
import mainBackground from "../assets/egas-bg.jpg";

// Mirrors backend/src/utils/passwordPolicy.js -- keep both in sync if this
// rule ever changes.
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

function isPasswordStrongEnough(password) {
  return password.length >= PASSWORD_MIN_LENGTH && PASSWORD_SYMBOL_PATTERN.test(password);
}

export default function Register() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const { register } = useAuth();
  const navigate = useNavigate();

  const [departments, setDepartments] = useState([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [landlineNumber, setLandlineNumber] = useState("");
  const [role, setRole] = useState("file_management");
  const [departmentKey, setDepartmentKey] = useState("");
  const [assignedItemKey, setAssignedItemKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get("/departments").then(({ data }) => setDepartments(data));
  }, []);

  const selectedDepartment = departments.find((d) => d.key === departmentKey);
  const isItemized = selectedDepartment?.signatureMode === "itemized";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("register.passwordMismatch"));
      return;
    }
    if (!isPasswordStrongEnough(password)) {
      setError(t("register.passwordTooWeak"));
      return;
    }

    setLoading(true);
    try {
      const user = await register({
        email,
        password,
        fullName,
        landlineNumber,
        role,
        departmentKey: role === "reviewer" ? departmentKey : undefined,
        assignedItemKey: role === "reviewer" && isItemized ? assignedItemKey : undefined,
      });
      navigate(user.role === "file_management" ? "/file-management" : "/reviewer");
    } catch (err) {
      setError(err.response?.data?.error || t("register.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page"
      style={{
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        padding: "24px 0"
      }}
    >
      <div className="auth-page-background"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${mainBackground})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          zIndex: 0
        }}
      />

      <div
        className="login-card auth-card auth-card--wide"
        style={{
          backgroundColor: "#f4f5f6",
          width: "100%",
          maxWidth: "420px",
          borderRadius: "16px",
          padding: "35px 30px 25px 30px",
          boxShadow: "0 12px 35px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
          zIndex: 10
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <img src={logoUrl} alt="EGAS" style={{ width: "64px", height: "64px", objectFit: "contain" }} />
        </div>

        <h2 style={{ margin: "0 0 5px 0", fontSize: "22px", color: "#111", fontWeight: "600" }}>
          {t("register.title")}
        </h2>
        <p style={{ margin: "0 0 20px 0", fontSize: "12px", color: "#666", textAlign: "center" }}>
          {t("register.subtitle")}
        </p>

        <SetupCoverageWarning />

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.fullName")}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.landlineNumber")}
            </label>
            <input
              type="tel"
              value={landlineNumber}
              onChange={(e) => setLandlineNumber(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.email")}
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          </div>

          <div style={{ marginBottom: "5px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.password")}
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={passwordInputStyle}
            />
          </div>
          <p style={{ margin: "4px 0 12px", fontSize: "11px", color: password && !isPasswordStrongEnough(password) ? "#d93025" : "#888" }}>
            {t("register.passwordHint")}
          </p>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.confirmPassword")}
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={passwordInputStyle}
            />
          </div>

          <p
            style={{
              margin: "0 0 20px",
              padding: "10px",
              borderRadius: "6px",
              backgroundColor: "#fff4d6",
              color: "#8a6710",
              fontSize: "11px",
              lineHeight: 1.5,
              textAlign: isAr ? "right" : "left"
            }}
          >
            {t("register.passwordWarning")}
          </p>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.roleLabel")}
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input
                  type="radio"
                  name="role"
                  checked={role === "file_management"}
                  onChange={() => setRole("file_management")}
                />
                {t("register.roleFileManagement")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <input type="radio" name="role" checked={role === "reviewer"} onChange={() => setRole("reviewer")} />
                {t("register.roleReviewer")}
              </label>
            </div>
          </div>

          {role === "reviewer" && (
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
                {t("register.departmentLabel")}
              </label>
              <select
                value={departmentKey}
                onChange={(e) => {
                  setDepartmentKey(e.target.value);
                  setAssignedItemKey("");
                }}
                required
                style={inputStyle}
              >
                <option value="">{t("register.departmentPlaceholder")}</option>
                {departments.map((d) => (
                  <option key={d.key} value={d.key}>
                    {isAr ? d.name_ar : d.name_en}
                  </option>
                ))}
              </select>
            </div>
          )}

          {role === "reviewer" && isItemized && (
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
                {t("register.itemLabel")}
              </label>
              <select
                value={assignedItemKey}
                onChange={(e) => setAssignedItemKey(e.target.value)}
                required
                style={inputStyle}
              >
                <option value="">{t("register.itemPlaceholder")}</option>
                {selectedDepartment.checklistItems.map((item) => (
                  <option key={item.key} value={item.key}>
                    {isAr ? item.label_ar : item.label_en}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p style={{ color: "#d93025", fontSize: "12px", marginBottom: "15px", textAlign: "center" }}>{error}</p>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading}
            style={{
              width: "100%",
              backgroundColor: "#008069",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "12px",
              fontSize: "14px",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? t("register.submitting") : t("register.submit")}
          </button>
        </form>

        <p className="auth-footer" style={{ margin: "16px 0 0", fontSize: "13px", color: "#666", textAlign: "center" }}>
          {t("register.haveAccount")}{" "}
          <Link to="/login" style={{ color: "#008069", fontWeight: "600", textDecoration: "none" }}>
            {t("register.signIn")}
          </Link>
        </p>
      </div>

      <SupportModal />
      <LanguageToggle />
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "6px",
  border: "1px solid #d1d5db",
  backgroundColor: "#eaecee",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box"
};

const passwordInputStyle = { ...inputStyle, paddingInlineEnd: "42px" };
