import { createContext, useContext, useState, useEffect, useRef } from "react";
import axios from "axios";
import { findUser, addAuditEntry } from "../lib/mockDb";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const AuthContext = createContext(null);
const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 min auto-logout

// Role-based page access
export const ROLE_ACCESS = {
  super_admin: ["dashboard", "evm", "voters", "voted", "parties", "blockchain", "fraud", "reports", "settings", "audit"],
  voter_manager: ["voters", "dashboard"],
  vote_tracker: ["voted", "dashboard"],
  election_officer: ["dashboard", "blockchain", "fraud", "reports"],
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("sv_token"));
  const [loading, setLoading] = useState(true);
  const idleTimer = useRef(null);

  useEffect(() => {
    const cached = localStorage.getItem("sv_user");
    if (token && cached) {
      // Offline/demo session restore
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      axios
        .get(`${API}/api/auth/me`)
        .then((r) => setUser(r.data))
        .catch(() => setUser(JSON.parse(cached)))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []); // eslint-disable-line

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

  const login = async (username, password) => {
    try {
      const form = new FormData();
      form.append("username", username);
      form.append("password", password);
      const { data } = await axios.post(`${API}/api/auth/login`, form);
      persistSession(data.access_token, data.user);
      addAuditEntry("LOGIN", username, "via API");
      return data.user;
    } catch {
      // Offline demo fallback — validates against the local mock user table
      const found = findUser(username, password);
      if (!found) {
        addAuditEntry("LOGIN_FAILED", username);
        throw { response: { data: { detail: "Invalid credentials" } } };
      }
      const demoUser = { ...found, id: found.username };
      delete demoUser.password;
      const demoToken = "demo-" + btoa(username) + "-" + Date.now();
      persistSession(demoToken, demoUser);
      addAuditEntry("LOGIN", username, "offline demo mode");
      return demoUser;
    }
  };

  const persistSession = (tok, u) => {
    localStorage.setItem("sv_token", tok);
    localStorage.setItem("sv_user", JSON.stringify(u));
    axios.defaults.headers.common["Authorization"] = `Bearer ${tok}`;
    setToken(tok);
    setUser(u);
  };

  const logout = () => {
    if (user) addAuditEntry("LOGOUT", user.username);
    localStorage.removeItem("sv_token");
    localStorage.removeItem("sv_user");
    delete axios.defaults.headers.common["Authorization"];
    setToken(null);
    setUser(null);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  };

  const canAccess = (page) => {
    if (!user) return false;
    return ROLE_ACCESS[user.role]?.includes(page) ?? false;
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, canAccess, loading }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
