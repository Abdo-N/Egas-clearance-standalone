import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import client from "../api/client";

// Public (no auth) reviewer-coverage check -- see GET /departments/coverage.
// Renders nothing once fully staffed, or while the check hasn't resolved yet
// (avoids a flash of the banner before the fetch completes).
export default function SetupCoverageWarning() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [coverage, setCoverage] = useState(null);

  useEffect(() => {
    client
      .get("/departments/coverage")
      .then(({ data }) => setCoverage(data))
      .catch(() => {});
  }, []);

  if (!coverage || coverage.isFullySetUp) return null;

  return (
    <div className="setup-warning-banner">
      <strong>{t("setupWarning.title")}</strong>
      <p>{t("setupWarning.intro")}</p>
      <ul>
        {coverage.missingDepartments.map((dept) => (
          <li key={dept.key}>{isAr ? dept.name_ar : dept.name_en}</li>
        ))}
        {coverage.missingItems.map((item) => (
          <li key={`${item.departmentKey}-${item.itemKey}`}>
            {isAr ? item.departmentName_ar : item.departmentName_en}
            {" — "}
            {isAr ? item.label_ar : item.label_en}
          </li>
        ))}
      </ul>
    </div>
  );
}
