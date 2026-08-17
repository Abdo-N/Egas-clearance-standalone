import { createContext, useContext, useState } from "react";
import client from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  async function login(email, password) {
    const { data } = await client.post("/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.setItem("setupComplete", "true");
    setUser(data.user);
    return data.user;
  }

  // Called from FirstRunSetup.jsx -- creates the very first admin account on
  // a brand-new deployment (POST /auth/setup, only works once, see
  // auth.routes.js) and logs straight into it, same response shape as
  // login, so setup "flows like normal after that" instead of bouncing back
  // to a login screen with credentials the person just typed a moment ago.
  async function completeSetup(payload) {
    const { data } = await client.post("/auth/setup", payload);
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.setItem("setupComplete", "true");
    setUser(data.user);
    return data.user;
  }

  // Called from the mandatory "set a new password" screen a one-time-password
  // login lands on (see auth.middleware.js -- that token can't reach any
  // other route until this succeeds). Same response shape as login,
  // with mustResetPassword now false, so the frontend gate clears.
  async function setNewPassword(currentPassword, newPassword) {
    const { data } = await client.post("/auth/set-new-password", { currentPassword, newPassword });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, completeSetup, setNewPassword, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
