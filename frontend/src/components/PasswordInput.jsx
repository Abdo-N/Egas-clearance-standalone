import { useState } from "react";
import { useTranslation } from "react-i18next";

function IconEye() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.2C11.05 5.07 11.52 5 12 5c6.4 0 10 7 10 7-.6 1.2-1.6 2.7-3 4M6.2 6.6C3.9 8.2 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A password <input> with a show/hide toggle -- drop-in replacement for
 * `<input type="password">` everywhere in the app (login, registration,
 * signing, reopen/undo re-auth). Forwards every other prop straight to the
 * input, so existing style/className/autoComplete/required usage keeps
 * working unchanged.
 */
export default function PasswordInput({ wrapperClassName, wrapperStyle, className, ...inputProps }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const label = t(visible ? "common.hidePassword" : "common.showPassword");

  return (
    <div className={`password-input-wrapper${wrapperClassName ? ` ${wrapperClassName}` : ""}`} style={wrapperStyle}>
      {/* `.password-input-control` (not just the bare element type) is
          deliberate -- every page that embeds this component inside its own
          container (`.form-group input`, `.inline-reauth-form input`, ...)
          defines its own `X input` padding/width rule at equal (0,1,1)
          specificity, which silently wins by source order whenever it's
          declared later in styles.css than `.password-input-wrapper input`
          was. That clobbered the reserved icon padding here in some
          contexts (text visibly ran under the toggle button) even though
          it worked fine in others -- a real bug, not just a style nitpick.
          Two classes (0,2,1) beats any single-class container rule (0,1,1)
          unconditionally, so this can't regress again regardless of what
          CSS a future container adds or which order rules end up in. */}
      <input {...inputProps} className={`password-input-control${className ? ` ${className}` : ""}`} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-toggle-button"
        onClick={() => setVisible((value) => !value)}
        aria-label={label}
        title={label}
        tabIndex={-1}
      >
        {visible ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  );
}
