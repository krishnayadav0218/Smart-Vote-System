import { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const AuthContext = createContext(null);

// Role-based page access
export const ROLE_ACCESS = {
  super_admin:   ["dashboard","evm","voters","voted","parties","blockchain","fraud","reports","settings"],
  voter_manager: ["voters"],
  vote_tracker:  ["voted"],
};

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(null);
  const [token, setToken] = useState(localStorage.getItem("sv_token"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      axios.get(`${API}/api/auth/me`)
        .then(r => setUser(r.data))
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const form = new FormData();
    form.append("username", username);
    form.append("password", password);
    const { data } = await axios.post(`${API}/api/auth/login`, form);
    localStorage.setItem("sv_token", data.access_token);
    axios.defaults.headers.common["Authorization"] = `Bearer ${data.access_token}`;
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("sv_token");
    delete axios.defaults.headers.common["Authorization"];
    setToken(null);
    setUser(null);
  };

  const canAccess = (page) => {
    if (!user) return false;
    return ROLE_ACCESS[user.role]?.includes(page) ?? false;
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, canAccess, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
