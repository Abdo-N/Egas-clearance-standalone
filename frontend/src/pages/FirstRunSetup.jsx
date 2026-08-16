import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import LanguageToggle from "../components/LanguageToggle";
import PasswordInput from "../components/PasswordInput";
import { dashboardPathFor } from "../utils/dashboardPath";
import logoUrl from "../assets/egas-logo.png";
import mainBackground from "../assets/egas-bg.jpg";

// Mirrors backend/src/utils/passwordPolicy.js -- same duplication as every
// other password field in this app (AdminDashboard.jsx, SetNewPassword.jsx).
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

function isPasswordStrongEnough(password) {
  return password.length >= PASSWORD_MIN_LENGTH && PASSWORD_SYMBOL_PATTERN.test(password);
}

// The very first screen a brand-new deployment's database (zero accounts)
// lands on -- Login.jsx redirects here on mount once GET /auth/setup-status
// says needsSetup. POST /auth/setup (see auth.routes.js) only ever succeeds
// once, so this page re-checks the same status itself and bounces back to
// /login if someone navigates here directly after setup is already done --
// otherwise it'd sit there as a dead-end form that just 409s on submit.
export default function FirstRunSetup() {
  const { t } = useTranslation();
  const { completeSetup } = useAuth();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("");
  const [landlineNumber, setLandlineNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client
      .get("/auth/setup-status")
      .then(({ data }) => {
        if (!data.needsSetup) navigate("/login", { replace: true });
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [navigate]);

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

    setLoading(true);
    try {
      const user = await completeSetup({ email, password, fullName, landlineNumber });
      toast.success(t("firstRunSetup.successToast"));
      navigate(dashboardPathFor(user.role));
    } catch (err) {
      setError(err.response?.data?.error || t("firstRunSetup.error"));
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <div
      className="auth-page"
      style={{
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        padding: "24px 0",
      }}
    >
      <div
        className="auth-page-background"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${mainBackground})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          zIndex: 0,
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
          zIndex: 10,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <img src={logoUrl} alt="EGAS" style={{ width: "64px", height: "64px", objectFit: "contain" }} />
        </div>

        <h1 style={{ margin: "0", fontSize: "24px", color: "#111", fontWeight: "700", textAlign: "center" }}>
          {t("firstRunSetup.greeting")}
        </h1>
        <h2 style={{ margin: "4px 0 10px 0", fontSize: "15px", color: "#333", fontWeight: "600", textAlign: "center" }}>
          {t("firstRunSetup.title")}
        </h2>
        <p style={{ margin: "0 0 20px 0", fontSize: "12px", color: "#666", textAlign: "center" }}>
          {t("firstRunSetup.subtitle")}
        </p>

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("firstRunSetup.fullNameLabel")}
            </label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={inputStyle} />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("firstRunSetup.landlineNumberLabel")}
            </label>
            <input type="tel" value={landlineNumber} onChange={(e) => setLandlineNumber(e.target.value)} required style={inputStyle} />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("firstRunSetup.emailLabel")}
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          </div>

          <div style={{ marginBottom: "5px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("firstRunSetup.passwordLabel")}
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={passwordInputStyle}
            />
          </div>
          <p
            style={{
              margin: "4px 0 12px",
              fontSize: "11px",
              color: password && !isPasswordStrongEnough(password) ? "#d93025" : "#888",
            }}
          >
            {t("passwordRules.hint")}
          </p>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("passwordRules.confirmLabel")}
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={passwordInputStyle}
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
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? t("firstRunSetup.submitting") : t("firstRunSetup.submit")}
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
  borderRadius: "6px",
  border: "1px solid #d1d5db",
  backgroundColor: "#eaecee",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const passwordInputStyle = { ...inputStyle, paddingInlineEnd: "42px" };
