import { NavLink, useNavigate } from "react-router-dom";
import { useAuth, ROLE_ACCESS } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useLang } from "../../context/LangContext";
import { getFraudAlerts } from "../../lib/mockDb";
import toast from "react-hot-toast";

// Nav items — id maps to ROLE_ACCESS keys and to i18n dictionary keys
const NAV_ITEMS = [
  { id:"dashboard",   icon:"🏠" },
  { id:"evm",         icon:"🗳️" },
  { id:"voters",      icon:"🏘️" },
  { id:"voted",       icon:"✅" },
  { id:"parties",     icon:"🏛️" },
  { id:"blockchain",  icon:"⛓️" },
  { id:"fraud",       icon:"🚨" },
  { id:"reports",     icon:"📊" },
  { id:"settings",    icon:"⚙️" },
  { id:"audit",       icon:"📜" },
];

const ROLE_COLORS = {
  super_admin:       "bg-blue-500/20 text-blue-300 border-blue-500/30",
  voter_manager:     "bg-green-500/20 text-green-300 border-green-500/30",
  vote_tracker:      "bg-purple-500/20 text-purple-300 border-purple-500/30",
  election_officer:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const ROLE_LABELS = {
  super_admin:      "Super Admin",
  voter_manager:     "Voter Manager",
  vote_tracker:      "Vote Tracker",
  election_officer:  "Election Officer",
};

// 🇮🇳 Tiranga Logo Component
export function TirangaBrand() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-9 h-9 rounded-xl overflow-hidden shadow-lg border border-gray-600 flex-shrink-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1" style={{background:"#FF9933"}}/>
          <div className="flex-1 bg-white flex items-center justify-center">
            <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none">
              <circle cx="10" cy="10" r="4" stroke="#000080" strokeWidth="1" fill="none"/>
              <circle cx="10" cy="10" r="0.8" fill="#000080"/>
              {[...Array(24)].map((_,i)=>{
                const a=(i*15)*Math.PI/180;
                return <line key={i}
                  x1={10+4*Math.cos(a)} y1={10+4*Math.sin(a)}
                  x2={10+2.8*Math.cos(a)} y2={10+2.8*Math.sin(a)}
                  stroke="#000080" strokeWidth="0.4"/>;
              })}
            </svg>
          </div>
          <div className="flex-1" style={{background:"#138808"}}/>
        </div>
        <div className="absolute inset-0 flex items-center justify-center text-lg">🗳️</div>
      </div>
      <div>
        <h2 className="text-sm font-bold text-white leading-tight">SmartVote</h2>
        <p className="text-[9px] text-slate-400 leading-tight">EVM · Blockchain</p>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { user, logout, canAccess } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLanguage, t } = useLang();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out securely");
    navigate("/login");
  };

  const visibleNav = NAV_ITEMS.filter(n => canAccess(n.id));
  const openAlerts = getFraudAlerts().filter(a => !a.reviewed).length;

  return (
    <aside className="w-56 min-w-56 bg-[#0b1529] border-r border-[#1e3050] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-[#1e3050]">
        <TirangaBrand />
      </div>

      {/* User info */}
      <div className="px-3 py-3 border-b border-[#1e3050]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {user?.full_name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{user?.full_name}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${ROLE_COLORS[user?.role]}`}>
              {ROLE_LABELS[user?.role]}
            </span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {visibleNav.map(item => (
          <NavLink
            key={item.id}
            to={`/${item.id}`}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-4 py-2 text-xs transition-all border-l-2 ${
                isActive
                  ? "bg-blue-500/15 text-blue-400 border-blue-500"
                  : "text-slate-400 border-transparent hover:bg-blue-500/5 hover:text-slate-200"
              }`
            }
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span className="flex-1">{t(item.id)}</span>
            {item.id === "fraud" && openAlerts > 0 && (
              <span className="text-[9px] bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">{openAlerts}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Theme / language quick toggles */}
      <div className="px-3 py-2 border-t border-[#1e3050] flex gap-2">
        <button onClick={toggleTheme} title="Toggle theme"
          className="flex-1 text-[10px] bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white rounded-lg py-1.5">
          {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
        </button>
        <button onClick={() => setLanguage(lang === "en" ? "hi" : "en")} title="Toggle language"
          className="flex-1 text-[10px] bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white rounded-lg py-1.5">
          {lang === "en" ? "🌐 EN" : "🌐 हिं"}
        </button>
      </div>

      {/* India flag strip at bottom */}
      <div className="flex h-1">
        <div className="flex-1" style={{background:"#FF9933"}}/>
        <div className="flex-1 bg-white"/>
        <div className="flex-1" style={{background:"#138808"}}/>
      </div>

      {/* Logout */}
      <div className="px-3 py-3 border-t border-[#1e3050]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 w-full text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          🚪 {t("logout")}
        </button>
      </div>
    </aside>
  );
}
