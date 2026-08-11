import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import client from "../api/client";

// A small photo/file preview of a department/item's uploaded evidence,
// fetched lazily (the underlying route requires the same auth token as
// everything else, so this can't just be a plain <img src="..."> -- pull it
// as a blob and hand the browser an object URL, same trick as the PDF
// download). Shared by RequestOversightGrid.jsx (oversight/File Management,
// beside a department's status) and SignaturePanel.jsx (a reviewer's own
// department/item, once they've signed it -- backend authorization already
// allowed this via `req.user.departmentKey === req.params.deptKey`, this
// component just makes it visible).
export default function EvidencePreview({ requestId, deptKey, itemKey, mimeType }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    async function load() {
      try {
        const path = itemKey
          ? `/requests/${requestId}/evidence/${deptKey}/${itemKey}`
          : `/requests/${requestId}/evidence/${deptKey}`;
        const { data } = await client.get(path, { responseType: "blob" });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestId, deptKey, itemKey]);

  if (failed) return null;
  if (!url) return <small className="no-signature">{t("common.loading")}</small>;

  const isImage = /^image\//.test(mimeType || "");
  return (
    <a href={url} target="_blank" rel="noreferrer" className="evidence-preview-link">
      {isImage && !imageFailed ? (
        <img
          src={url}
          alt={t("common.evidencePreviewAlt")}
          className="signature-thumb"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="secondary-button">{t("common.viewEvidenceFile")}</span>
      )}
    </a>
  );
}
