import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import LanguageToggle from "../components/LanguageToggle";
import PasswordInput from "../components/PasswordInput";
import logoUrl from "../assets/egas-logo.png";
import mainBackground from "../assets/egas-bg.jpg";

// Mirrors backend/src/utils/passwordPolicy.js -- same duplication as Register.jsx.
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

function isPasswordStrongEnough(password) {
  return password.length >= PASSWORD_MIN_LENGTH && PASSWORD_SYMBOL_PATTERN.test(password);
}

// Landing screen for a login that used a one-time password IT issued (see
// POST /auth/reset-password) -- the backend refuses every other route until
// this succeeds (requireAuth in auth.middleware.js), so this page has no
// "skip for now" option.
export default function SetNewPassword() {
  const { t } = useTranslation();
  const { user, setNewPassword } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustResetPassword) {
    return <Navigate to={user.role === "file_management" ? "/file-management" : "/reviewer"} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (newPasswordValue !== confirmPassword) {
      setError(t("register.passwordMismatch"));
      return;
    }
    if (!isPasswordStrongEnough(newPasswordValue)) {
      setError(t("register.passwordTooWeak"));
      return;
    }

    setLoading(true);
    try {
      const updated = await setNewPassword(currentPassword, newPasswordValue);
      navigate(updated.role === "file_management" ? "/file-management" : "/reviewer");
    } catch (err) {
      setError(err.response?.data?.error || t("setNewPassword.error"));
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
        className="login-card auth-card"
        style={{
          backgroundColor: "#f4f5f6",
          width: "100%",
          maxWidth: "380px",
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
          {t("setNewPassword.title")}
        </h2>
        <p style={{ margin: "0 0 20px 0", fontSize: "12px", color: "#666", textAlign: "center" }}>
          {t("setNewPassword.subtitle")}
        </p>

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("setNewPassword.currentPasswordLabel")}
            </label>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "5px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("setNewPassword.newPasswordLabel")}
            </label>
            <PasswordInput
              value={newPasswordValue}
              onChange={(e) => setNewPasswordValue(e.target.value)}
              autoComplete="new-password"
              required
              style={inputStyle}
            />
          </div>
          <p
            style={{
              margin: "4px 0 12px",
              fontSize: "11px",
              color: newPasswordValue && !isPasswordStrongEnough(newPasswordValue) ? "#d93025" : "#888"
            }}
          >
            {t("register.passwordHint")}
          </p>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("register.confirmPassword")}
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={inputStyle}
            />
          </div>

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
            {loading ? t("setNewPassword.submitting") : t("setNewPassword.submit")}
          </button>
        </form>
      </div>

      <LanguageToggle />
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  paddingInlineEnd: "42px",
  borderRadius: "6px",
  border: "1px solid #d1d5db",
  backgroundColor: "#eaecee",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box"
};
