import { useTranslation } from "react-i18next";

// Small "search by employee number or name" filter shared by the reviewer
// and File Management request lists -- request history grows unbounded over
// time, so both need a way to jump straight to an employee's existing
// request instead of scrolling every request ever filed. Partial match on
// either field, handled server-side (see buildEmployeeSearchFilter in
// request.routes.js).
export default function EmployeeSearchFilter({ value, onChange }) {
  const { t } = useTranslation();

  return (
    <div className="employee-number-filter">
      <div className="form-group">
        <label htmlFor="employeeSearch">{t("common.employeeSearchLabel")}</label>
        <input
          id="employeeSearch"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {value && (
        <button type="button" className="secondary-button employee-number-clear" onClick={() => onChange("")}>
          {t("common.employeeSearchClear")}
        </button>
      )}
    </div>
  );
}
