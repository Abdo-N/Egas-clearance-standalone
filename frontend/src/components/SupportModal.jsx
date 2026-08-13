import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import client from "../api/client";

const SupportModal = () => {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [isOpen, setIsOpen] = useState(false);
  const [adminContacts, setAdminContacts] = useState([]);
  const [itContacts, setItContacts] = useState([]);

  // Public/no-auth, same as the login page's own "Forgot your password?"
  // disclosure -- someone hitting "Need help?" has no token either. Admins
  // and super_admins are listed alongside IT since there's no more
  // self-service sign-up: a brand-new person needs to know an admin (or,
  // failing that, a super_admin) exists to ask for an account, not just IT
  // for a password reset.
  useEffect(() => {
    client.get("/auth/admin-contacts").then(({ data }) => setAdminContacts(data)).catch(() => {});
    client.get("/auth/it-contacts").then(({ data }) => setItContacts(data)).catch(() => {});
  }, []);

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

          {(adminContacts.length > 0 || itContacts.length > 0) && (
            <div className="support-contacts" style={{ marginBottom: "15px" }}>
              <span style={{ fontSize: "13px", color: "#666", display: "block", marginBottom: "6px" }}>
                {t("support.contactsLabel")}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "180px", overflowY: "auto" }}>
                {adminContacts.map((contact) => (
                  <div key={contact.userID} style={{ fontSize: "13px", backgroundColor: "#f0f4f8", borderRadius: "6px", padding: "8px 10px" }}>
                    <div style={{ fontWeight: "bold", marginBottom: "2px" }}>
                      {isAr ? contact.fullName_ar || contact.fullName : contact.fullName}
                      {" · "}
                      {contact.role === "super_admin" ? t("support.roleSuperAdmin") : t("support.roleAdmin")}
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <a href={`mailto:${contact.userID}`} style={{ color: "#0056b3" }}>{contact.userID}</a>
                      {contact.landlineNumber && (
                        <a href={`tel:${contact.landlineNumber}`} style={{ color: "#0056b3" }}>{contact.landlineNumber}</a>
                      )}
                    </div>
                  </div>
                ))}
                {itContacts.map((contact) => (
                  <div key={contact.userID} style={{ fontSize: "13px", backgroundColor: "#f0f4f8", borderRadius: "6px", padding: "8px 10px" }}>
                    <div style={{ fontWeight: "bold", marginBottom: "2px" }}>
                      {isAr ? contact.fullName_ar || contact.fullName : contact.fullName}
                      {" · "}
                      {t("support.roleIt")}
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <a href={`mailto:${contact.userID}`} style={{ color: "#0056b3" }}>{contact.userID}</a>
                      {contact.landlineNumber && (
                        <a href={`tel:${contact.landlineNumber}`} style={{ color: "#0056b3" }}>{contact.landlineNumber}</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupportModal;
