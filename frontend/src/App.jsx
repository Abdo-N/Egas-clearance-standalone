import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import Login from "./pages/Login";
import FirstRunSetup from "./pages/FirstRunSetup";
import SetNewPassword from "./pages/SetNewPassword";
import FileManagementDashboard from "./pages/FileManagementDashboard";
import ReviewerDashboard from "./pages/ReviewerDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import { dashboardPathFor } from "./utils/dashboardPath";

// A one-time-password login can't reach any route but /set-new-password on
// the backend either (see requireAuth in auth.middleware.js) -- this just
// keeps the frontend from rendering a dashboard it would immediately 403 on.
function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustResetPassword) return <Navigate to="/set-new-password" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/login" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustResetPassword) return <Navigate to="/set-new-password" replace />;
  return <Navigate to={dashboardPathFor(user.role)} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<FirstRunSetup />} />
          <Route path="/set-new-password" element={<SetNewPassword />} />
          <Route
            path="/file-management"
            element={
              <RequireRole roles={["file_management"]}>
                <FileManagementDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/reviewer"
            element={
              <RequireRole roles={["reviewer"]}>
                <ReviewerDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <AdminDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/super-admin"
            element={
              <RequireRole roles={["super_admin"]}>
                <AdminDashboard />
              </RequireRole>
            }
          />
          <Route path="/" element={<Home />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
