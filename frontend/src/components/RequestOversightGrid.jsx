import { useTranslation } from "react-i18next";
import DepartmentIcon from "./DepartmentIcon";
import EvidencePreview from "./EvidencePreview";
import ReauthConfirmButton from "./ReauthConfirmButton";
import { formatDate } from "../utils/formatDate";

// Labeled name/date/email/landline block -- landline is omitted when absent
// (accounts registered before landlineNumber became required won't have
// one).
function SignerInfo({ fullName, signedAt, userID, landlineNumber, lang, t }) {
  return (
    <div className="oversight-grid-signer">
      <div className="oversight-grid-signer-field">
        <span>{t("common.signerName")}</span>
        <strong>{fullName}</strong>
      </div>
      <div className="oversight-grid-signer-field">
        <span>{t("common.signerDate")}</span>
        <strong>{formatDate(signedAt, lang)}</strong>
      </div>
      <div className="oversight-grid-signer-field">
        <span>{t("common.signerEmail")}</span>
        <strong>{userID}</strong>
      </div>
      {landlineNumber && (
        <div className="oversight-grid-signer-field">
          <span>{t("common.signerLandline")}</span>
          <strong>{landlineNumber}</strong>
        </div>
      )}
    </div>
  );
}

function ReopenControl({ onConfirm, t }) {
  return (
    <ReauthConfirmButton
      openLabel={t("fileManagement.reopenButton")}
      confirmLabel={t("fileManagement.confirmReopen")}
      busyLabel={t("fileManagement.reopening")}
      cancelLabel={t("fileManagement.cancel")}
      errorFallback={t("fileManagement.reopenError")}
      onConfirm={onConfirm}
    />
  );
}

/**
 * The 13-department status grid, shared by wages/finance oversight and File
 * Management (see summarizeForFileManagement / withOwnDepartmentAnnotated in
 * request.routes.js) -- both now get the same per-department detail: status,
 * who signed, when, and how to reach them (email + landline), plus an inline
 * evidence photo/file preview next to a completed department/item's status,
 * live as each one signs.
 *
 * `onReopenDepartment`/`onReopenItem` are optional (File Management only --
 * see FileManagementDashboard.jsx). When provided, a "Reopen" control shows
 * next to any already-signed row/item so File Management can undo a
 * signature that turned out illegible and let the department sign again.
 */
export default function RequestOversightGrid({ request, onReopenDepartment, onReopenItem }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const sorted = [...request.departments].sort((a, b) => a.order - b.order);

  // Every department signing off is NOT the same as the employee being
  // cleared -- IT revoking their system access is the real final
  // step (see request.routes.js computeOverallStatus). Without this, a
  // fully-signed-but-not-yet-revoked request just reads as generic
  // "in progress" with no hint of what it's actually waiting on.
  const awaitingAccessRevocation = !request.accessRevoked && request.readyForAccessRevocation;

  return (
    <>
      {request.accessRevoked && (
        <div className="archived-marker">
          <span>✓</span>
          {t("common.accessRevokedMarker")}
          {request.accessRevokedAt && <small> · {formatDate(request.accessRevokedAt, i18n.language)}</small>}
        </div>
      )}
      {awaitingAccessRevocation && (
        <div className="awaiting-marker">
          <span>⏳</span>
          {t("common.awaitingAccessRevocationMarker")}
        </div>
      )}

      <div className="detail-progress-track">
        {sorted.map((d) => (
          <div
            key={d.departmentKey}
            className={`detail-progress-segment ${d.status}`}
            title={isAr ? d.name_ar : d.name_en}
          />
        ))}
      </div>

      <div className="checklist-box">
        <ul className="checklist-items">
          {sorted.map((d) => {
            const isIt = d.departmentKey === "it";
            const canReopenDept = onReopenDepartment && d.signatureMode === "single" && d.status === "completed";
            return (
              <li key={d.departmentKey}>
                <span className="request-list-dept">
                  <DepartmentIcon departmentKey={d.departmentKey} className="request-list-icon" />
                  {isAr ? d.name_ar : d.name_en}
                </span>
                <span className={`status-pill ${d.status}`}>
                  {d.status === "completed" ? t("employee.departmentCompleted") : t("employee.departmentPending")}
                </span>
                {isIt && d.status === "completed" && awaitingAccessRevocation && (
                  <small className="oversight-grid-it-note">{t("common.itAccessRevocationPendingNote")}</small>
                )}
                {d.status === "completed" && d.signatureMode === "single" && (
                  <SignerInfo
                    fullName={d.signedByFullName}
                    signedAt={d.signedAt}
                    userID={d.signedByUserID}
                    landlineNumber={d.signedByLandlineNumber}
                    lang={i18n.language}
                    t={t}
                  />
                )}
                {d.status === "completed" && d.evidence && d.signatureMode === "single" && (
                  <EvidencePreview requestId={request._id} deptKey={d.departmentKey} mimeType={d.evidence.mimeType} />
                )}
                {d.status === "completed" && d.hasOversightDashboard && d.notes && (
                  <p className="oversight-grid-notes">{d.notes}</p>
                )}
                {canReopenDept && (
                  <ReopenControl t={t} onConfirm={(password) => onReopenDepartment(d.departmentKey, password)} />
                )}
                {d.signatureMode === "itemized" && d.items?.length > 0 && (
                  <ul className="checklist-items oversight-grid-items">
                    {d.items.map((item) => (
                      <li key={item.key}>
                        <span className="oversight-grid-item-label">
                          {isAr ? item.label_ar : item.label_en}
                        </span>
                        <span className={`status-pill ${item.status}`}>
                          {item.status === "completed" ? t("employee.departmentCompleted") : t("employee.departmentPending")}
                        </span>
                        {item.status === "completed" && (
                          <SignerInfo
                            fullName={item.signedByFullName}
                            signedAt={item.signedAt}
                            userID={item.signedByUserID}
                            landlineNumber={item.signedByLandlineNumber}
                            lang={i18n.language}
                            t={t}
                          />
                        )}
                        <span className="oversight-grid-item-actions">
                          {item.status === "completed" && item.evidence && (
                            <EvidencePreview
                              requestId={request._id}
                              deptKey={d.departmentKey}
                              itemKey={item.key}
                              mimeType={item.evidence.mimeType}
                            />
                          )}
                          {item.status === "completed" && onReopenItem && (
                            <ReopenControl
                              t={t}
                              onConfirm={(password) => onReopenItem(d.departmentKey, item.key, password)}
                            />
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
