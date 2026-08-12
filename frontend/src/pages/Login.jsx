import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import SupportModal from "../components/SupportModal";
import LanguageToggle from "../components/LanguageToggle";
import PasswordInput from "../components/PasswordInput";
import SetupCoverageWarning from "../components/SetupCoverageWarning";
import {
  DEMO_PASSWORD,
  demoDepartmentReviewers,
  demoFileManagement,
  demoItReviewers,
} from "../demoAccounts";
import logoUrl from "../assets/egas-logo.png";

// الخلفية الكبيرة للشاشة بالكامل (المنصة والغروب)
import mainBackground from "../assets/egas-bg.jpg";

// Temporarily hidden (2026-08-12, Nader) to test the login page without the
// demo-accounts card in the way -- flip back to true once done testing.
const SHOW_DEMO_ACCOUNTS = false;

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const isArabic = i18n.language === "ar";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [itContacts, setItContacts] = useState([]);

  useEffect(() => {
    client.get("/auth/it-contacts").then(({ data }) => setItContacts(data));
  }, []);

  function fillDemoAccount(account) {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setError("");
  }

  function renderDemoAccount(account) {
    return (
      <button type="button" key={account.email} onClick={() => fillDemoAccount(account)}>
        <span className="demo-account-identity">
          <strong>{isArabic ? account.label_ar : account.label_en}</strong>
          <small className="demo-account-email">{account.email}</small>
        </span>
        <span className="demo-account-use">{t("login.demoAccounts.use")}</span>
      </button>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.mustResetPassword) {
        navigate("/set-new-password");
      } else {
        navigate(user.role === "file_management" ? "/file-management" : "/reviewer");
      }
    } catch (err) {
      setError(t("login.error") || "اسم المستخدم أو كلمة المرور غير صحيحة");
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
      {/* طبقة الخلفية -- ثابتة بحجم الشاشة، منفصلة عن ارتفاع المحتوى حتى لا
          "تكبر" الصورة عند تمدد بطاقة تسجيل الدخول (مثلاً فتح حسابات الديمو) */}
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

      {/* كارت تسجيل الدخول الأبيض النظيف والمتسنتر بدقة */}
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
        {/* اللوجو الرسمي */}
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <img src={logoUrl} alt="EGAS" style={{ width: "64px", height: "64px", objectFit: "contain" }} />
        </div>

        {/* اسم الخدمة */}
        <div
          style={{
            fontSize: "13px",
            fontWeight: "700",
            color: "#008069",
            textTransform: "uppercase",
            letterSpacing: "0.6px",
            marginBottom: "10px",
            textAlign: "center"
          }}
        >
          {t("appTitle")}
        </div>

        {/* العناوين */}
        <h2 style={{ margin: "0 0 5px 0", fontSize: "22px", color: "#111", fontWeight: "600" }}>
          {t("login.title")}
        </h2>
        <p style={{ margin: "0 0 20px 0", fontSize: "12px", color: "#666", textAlign: "center" }}>
          {t("login.subtitle")}
        </p>

        <SetupCoverageWarning />

        {/* الحقول والنموذج */}
        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("login.email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "6px",
                border: "1.5px solid #008069",
                backgroundColor: "#eaecee",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box"
              }}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#333", marginBottom: "5px", fontWeight: "500" }}>
              {t("login.password")}
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                paddingInlineEnd: "42px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: "#eaecee",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box"
              }}
            />
          </div>

          {error && (
            <p style={{ color: "#d93025", fontSize: "12px", marginBottom: "15px", textAlign: "center" }}>
              {error}
            </p>
          )}

          {/* زر تسجيل الدخول */}
          <button
            type="submit"
            className="login-submit-btn auth-submit"
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
            {loading ? t("employee.submitting") : t("login.submit")}
          </button>
        </form>

        <details className="login-demo-accounts">
          <summary>{t("login.forgotPassword.toggle")}</summary>
          <p className="demo-accounts-hint">{t("login.forgotPassword.hint")}</p>
          {itContacts.length === 0 ? (
            <p className="demo-accounts-hint">{t("login.forgotPassword.empty")}</p>
          ) : (
            <div className="demo-accounts-list">
              {itContacts.map((contact) => (
                <div className="it-contact-row" key={contact.userID}>
                  <span className="demo-account-identity">
                    <strong>{isArabic ? contact.fullName_ar || contact.fullName : contact.fullName}</strong>
                  </span>
                  <span className="it-contact-links">
                    <a href={`mailto:${contact.userID}`}>{contact.userID}</a>
                    {contact.landlineNumber && <a href={`tel:${contact.landlineNumber}`}>{contact.landlineNumber}</a>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </details>

        {SHOW_DEMO_ACCOUNTS && (
          <details className="login-demo-accounts">
            <summary>{t("login.demoAccounts.summary")}</summary>
            <p className="demo-accounts-hint">{t("login.demoAccounts.hint")}</p>

            <section className="demo-accounts-group">
              <h4>{t("login.demoAccounts.fileManagement")}</h4>
              <div className="demo-accounts-list">{renderDemoAccount(demoFileManagement)}</div>
            </section>

            <section className="demo-accounts-group">
              <h4>{t("login.demoAccounts.departments")}</h4>
              <div className="demo-accounts-list demo-accounts-list--scroll">
                {demoDepartmentReviewers.map(renderDemoAccount)}
              </div>
            </section>

            <section className="demo-accounts-group">
              <h4>{t("login.demoAccounts.it")}</h4>
              <div className="demo-accounts-list">{demoItReviewers.map(renderDemoAccount)}</div>
            </section>

            <p className="demo-accounts-note">
              {t("login.demoAccounts.password")} <code>{DEMO_PASSWORD}</code>
            </p>
          </details>
        )}

        {/* رابط إنشاء حساب */}
        <p className="auth-footer" style={{ margin: "16px 0 0", fontSize: "13px", color: "#666", textAlign: "center" }}>
          {t("login.noAccount")}{" "}
          <Link to="/register" style={{ color: "#008069", fontWeight: "600", textDecoration: "none" }}>
            {t("login.createAccount")}
          </Link>
        </p>
      </div>

      <SupportModal />
      <LanguageToggle />
    </div>
  );
}
