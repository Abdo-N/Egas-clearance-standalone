import { useState } from "react";
import { useTranslation } from "react-i18next";

const SupportModal = () => {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [isOpen, setIsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (phone) {
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setIsOpen(false);
        setPhone("");
      }, 3000);
    }
  };

  return (
    <div className="support-widget" style={{ position: "fixed", bottom: "20px", left: "20px", zIndex: 1000 }}>
      {!isOpen && (
        <button
          type="button"
          className="support-toggle"
          onClick={() => setIsOpen(true)}
          style={{
            backgroundColor: "#0056b3",
            color: "#fff",
            border: "none",
            borderRadius: "50px",
            padding: "12px 20px",
            fontSize: "16px",
            fontWeight: "bold",
            boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>💬 {t("support.toggleButton")}</span>
        </button>
      )}

      {isOpen && (
        <div
          className="support-dialog"
          role="dialog"
          aria-modal="true"
          style={{
            backgroundColor: "#fff",
            border: "2px solid #0056b3",
            borderRadius: "12px",
            padding: "20px",
            width: "320px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            direction: isAr ? "rtl" : "ltr",
            textAlign: isAr ? "right" : "left",
          }}
        >
          <div className="support-dialog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", color: "#0056b3" }}>{t("support.title")}</h3>
            <button
              type="button"
              className="support-close"
              aria-label="Close"
              onClick={() => setIsOpen(false)}
              style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer" }}
            >
              ✖
            </button>
          </div>

          <p style={{ fontSize: "14px", color: "#555", marginBottom: "15px" }}>{t("support.intro")}</p>

          <div className="support-hotline" style={{ backgroundColor: "#f0f4f8", padding: "10px", borderRadius: "8px", marginBottom: "15px" }}>
            <span style={{ fontSize: "13px", color: "#666" }}>{t("support.hotlineLabel")}</span>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#0056b3", direction: "ltr", textAlign: "center", marginTop: "5px" }}>
              <a href="tel:16xxx" style={{ textDecoration: "none", color: "inherit" }}>16XXX / 02-XXXXXXX</a>
            </div>
          </div>

          {!submitted ? (
            <form className="support-form" onSubmit={handleSubmit}>
              <label style={{ display: "block", fontSize: "13px", marginBottom: "5px" }}>
                {t("support.callbackLabel")}
              </label>
              <input
                type="tel"
                placeholder={t("support.callbackPlaceholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  marginBottom: "10px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="submit"
                className="support-submit"
                style={{
                  width: "100%",
                  backgroundColor: "#28a745",
                  color: "#fff",
                  border: "none",
                  padding: "10px",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {t("support.callbackButton")}
              </button>
            </form>
          ) : (
            <div style={{ backgroundColor: "#d4edda", color: "#155724", padding: "10px", borderRadius: "6px", textAlign: "center", fontSize: "14px" }}>
              {t("support.callbackSuccess")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupportModal;
