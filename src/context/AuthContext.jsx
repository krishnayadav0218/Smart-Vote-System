import { createContext, useContext, useState, useEffect, useRef } from "react";
import axios from "axios";
import { findUser, addAuditEntry } from "../lib/mockDb";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const AuthContext = createContext(null);
const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 min auto-logout (client-side; server session also expires independently)

export const ROLE_ACCESS = {
  super_admin: ["dashboard", "evm", "voters", "voted", "parties", "blockchain", "fraud", "reports", "settings", "audit"],
  voter_manager: ["voters", "dashboard"],
  vote_tracker: ["voted", "dashboard"],
  election_officer: ["dashboard", "blockchain", "fraud", "reports"],
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [offline, setOffline] = useState(false); // true when using the localStorage mock fallback (no real backend)
  const [loading, setLoading] = useState(true);
  const idleTimer = useRef(null);

  useEffect(() => {
    // Try to restore a live cookie session first; fall back to the offline demo user if that fails.
    axios.get(`${API}/api/auth/me`)
      .then((r) => { setUser(r.data); setOffline(false); })
      .catch(() => {
        const cached = localStorage.getItem("sv_offline_user");
        if (cached) { setUser(JSON.parse(cached)); setOffline(true); }
      })
      .finally(() => setLoading(false));
  }, []);

  const resetIdleTimer = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      addAuditEntry("SESSION_IDLE_TIMEOUT", user?.username || "unknown");
      logout();
    }, IDLE_LIMIT_MS);
  };

  useEffect(() => {
    if (!user) return;
    const events = ["mousemove", "keydown", "click"];
    events.forEach((e) => window.addEventListener(e, resetIdleTimer));
    resetIdleTimer();
    return () => events.forEach((e) => window.removeEventListener(e, resetIdleTimer));
  }, [user]); // eslint-disable-line

  // Step 1: submit username/password. Returns either a logged-in user, or
  // { requires2fa: true, tempToken } if the account has an authenticator enabled.
  const login = async (username, password) => {
    try {
      const { data } = await axios.post(`${API}/api/auth/login`, { username, password });
      if (data.requires_2fa) {
        return { requires2fa: true, tempToken: data.temp_token };
      }
      setUser(data.user);
      setOffline(false);
      return { requires2fa: false, user: data.user };
    } catch (err) {
      if (err.response) throw err; // real backend reachable but rejected (bad creds, locked, rate-limited)
      // Offline demo fallback — validates against the local mock user table
      const found = findUser(username, password);
      if (!found) {
        addAuditEntry("LOGIN_FAILED", username);
        throw { response: { data: { detail: "Invalid credentials" } } };
      }
      const demoUser = { ...found, id: found.username };
      delete demoUser.password;
      localStorage.setItem("sv_offline_user", JSON.stringify(demoUser));
      setUser(demoUser);
      setOffline(true);
      addAuditEntry("LOGIN", username, "offline demo mode");
      return { requires2fa: false, user: demoUser };
    }
  };

  // Step 2 (only when login() returned requires2fa): submit the 6-digit authenticator code.
  const verify2fa = async (tempToken, code) => {
    const { data } = await axios.post(`${API}/api/auth/2fa/verify`, { temp_token: tempToken, code });
    setUser(data.user);
    setOffline(false);
    return data.user;
  };

  const logout = async () => {
    if (offline) {
      localStorage.removeItem("sv_offline_user");
      if (user) addAuditEntry("LOGOUT", user.username);
    } else {
      try { await axios.post(`${API}/api/auth/logout`); } catch { /* ignore */ }
    }
    setUser(null);
    setOffline(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  };

  const canAccess = (page) => {
    if (!user) return false;
    return ROLE_ACCESS[user.role]?.includes(page) ?? false;
  };

  return (
    <AuthContext.Provider value={{ user, offline, login, verify2fa, logout, canAccess, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
