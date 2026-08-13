import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchCurrentUser, loginRequest, logoutRequest } from "./api";

// ─────────────────────────────────────────────────────────────
// Phase 14 §1/§3 — Auth context. Mounted once at the very top of
// App.jsx, above every other provider, so App can decide whether to
// render the Login page or the rest of the (already-existing,
// untouched) application shell based on session state alone.
//
// Session itself lives entirely server-side (httpOnly JWT cookie set
// by POST /api/auth/login — see server/lib/auth.js). This context
// never sees or stores a token; it only tracks the logged-in user's
// {id, email, role} and a status flag, both sourced from GET
// /api/auth/me. That "am I logged in" check runs once on mount so a
// page refresh doesn't bounce an already-authenticated user back to
// the login screen.
// ─────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("checking"); // "checking" | "authenticated" | "unauthenticated"

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await loginRequest(email, password);
    setUser(res.user);
    setStatus("authenticated");
    return res.user;
  }, []);

  // Phase 14 §3 — global session-expiry handler. api.js broadcasts this
  // event whenever any protected call comes back 401 (expired token,
  // cookie cleared, account disabled mid-session) so the whole app
  // falls back to the Login page instead of leaving every open page
  // silently broken with unauthenticated fetch errors.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Even if the server call fails (e.g. cookie already expired),
      // still drop the client-side session so the user isn't stuck.
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = {
    user,
    status,
    isAuthenticated: status === "authenticated",
    isAdmin: user?.role === "admin",
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
