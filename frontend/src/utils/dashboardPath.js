// Where each role lands after login / after mustResetPassword clears --
// shared by App.jsx (route guards), Login.jsx, and SetNewPassword.jsx so
// they can't drift out of sync with each other.
export function dashboardPathFor(role) {
  if (role === "file_management") return "/file-management";
  if (role === "admin") return "/admin";
  if (role === "super_admin") return "/super-admin";
  return "/reviewer";
}
