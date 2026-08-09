import { useTranslation } from "react-i18next";

// Small "requested on" date-range filter shared by the reviewer and File
// Management request lists -- request history grows unbounded over time, so
// both need a way to narrow down to a range instead of scrolling every
// request ever filed. `from`/`to` are plain "YYYY-MM-DD" strings (or "") so
// callers can pass them straight through as query params.
export default function DateRangeFilter({ from, to, onFromChange, onToChange }) {
  const { t } = useTranslation();
  const hasFilter = Boolean(from || to);

  return (
    <div className="date-range-filter">
      <div className="form-group">
        <label htmlFor="dateRangeFrom">{t("common.dateRangeFrom")}</label>
        <input
          id="dateRangeFrom"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onFromChange(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="dateRangeTo">{t("common.dateRangeTo")}</label>
        <input
          id="dateRangeTo"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onToChange(e.target.value)}
        />
      </div>
      {hasFilter && (
        <button
          type="button"
          className="secondary-button date-range-clear"
          onClick={() => {
            onFromChange("");
            onToChange("");
          }}
        >
          {t("common.dateRangeClear")}
        </button>
      )}
    </div>
  );
}
