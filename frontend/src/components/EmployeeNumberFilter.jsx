import { useTranslation } from "react-i18next";

// Small "search by employee number" filter shared by the reviewer and File
// Management request lists -- request history grows unbounded over time, so
// both need a way to jump straight to an employee's existing request instead
// of scrolling every request ever filed. Partial match, handled server-side
// (see buildEmployeeNumberFilter in request.routes.js).
export default function EmployeeNumberFilter({ value, onChange }) {
  const { t } = useTranslation();

  return (
    <div className="employee-number-filter">
      <div className="form-group">
        <label htmlFor="employeeNumberSearch">{t("common.employeeNumberSearchLabel")}</label>
        <input
          id="employeeNumberSearch"
          type="text"
          value={value}
          placeholder={t("common.employeeNumberSearchPlaceholder")}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {value && (
        <button type="button" className="secondary-button employee-number-clear" onClick={() => onChange("")}>
          {t("common.employeeNumberSearchClear")}
        </button>
      )}
    </div>
  );
}
