// Shared password-strength rule for admin-created accounts (see
// POST /auth/accounts) and self-chosen new passwords (set-new-password): at
// least 12 characters and at least one symbol. Duplicated on the frontend
// (AdminDashboard.jsx) for live feedback -- keep both in sync if this rule
// ever changes, same pattern as e.g. the chart color constants duplicated
// between DepartmentDashboard.jsx and its CSS.
const MIN_LENGTH = 12;
const SYMBOL_PATTERN = /[^A-Za-z0-9]/;

function isPasswordStrongEnough(password) {
  return typeof password === "string" && password.length >= MIN_LENGTH && SYMBOL_PATTERN.test(password);
}

module.exports = { isPasswordStrongEnough, MIN_LENGTH };
