import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import toast from "react-hot-toast";

function TirangaLogo() {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16 rounded-2xl overflow-hidden shadow-lg border-2 border-gray-700">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1" style={{ background: "#FF9933" }} />
          <div className="flex-1 bg-white flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
              <circle cx="12" cy="12" r="5" stroke="#000080" strokeWidth="1.2" fill="none"/>
              <circle cx="12" cy="12" r="1" fill="#000080"/>
              {[...Array(24)].map((_,i)=>{
                const a=(i*15)*Math.PI/180;
                return <line key={i} x1={12+5*Math.cos(a)} y1={12+5*Math.sin(a)} x2={12+3.5*Math.cos(a)} y2={12+3.5*Math.sin(a)} stroke="#000080" strokeWidth="0.5"/>;
              })}
            </svg>
          </div>
          <div className="flex-1" style={{ background: "#138808" }} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl drop-shadow-lg">🗳️</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login, verify2fa } = useAuth();
  const { lang, setLanguage, t } = useLang();
  const navigate  = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [showPass, setShowPass] = useState(false);

  // 2FA step state
  const [needs2fa, setNeeds2fa] = useState(false);
  const [tempToken, setTempToken] = useState(null);
  const [code, setCode] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError("Please enter credentials"); return; }
    setError(""); setLoading(true);
    try {
      const result = await login(username, password);
      if (result.requires2fa) {
        setNeeds2fa(true);
        setTempToken(result.tempToken);
      } else {
        toast.success(`Welcome, ${result.user.full_name}!`);
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e) => {
    e.preventDefault();
    if (!code.trim()) { setError("Enter your 6-digit authenticator code"); return; }
    setError(""); setLoading(true);
    try {
      const user = await verify2fa(tempToken, code.trim());
      toast.success(`Welcome, ${user.full_name}!`);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Incorrect code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#060d1f] via-[#0b1529] to-[#060d1f]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"/>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl"/>
      </div>

      <button onClick={() => setLanguage(lang === "en" ? "hi" : "en")}
        className="absolute top-4 right-4 text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg z-10">
        {lang === "en" ? "🌐 हिन्दी" : "🌐 English"}
      </button>

      <div className="relative w-full max-w-sm mx-4">
        <div className="bg-[#0b1529] border border-[#1e3050] rounded-2xl p-8 shadow-2xl">

          <div className="text-center mb-8">
            <TirangaLogo />
            <h1 className="text-xl font-bold text-white mt-3">{t("login_title")}</h1>
            <p className="text-xs text-slate-400 mt-1">{t("login_subtitle")}</p>
            <div className="flex h-1 rounded-full overflow-hidden w-24 mx-auto mt-3">
              <div className="flex-1" style={{background:"#FF9933"}}/>
              <div className="flex-1 bg-white"/>
              <div className="flex-1" style={{background:"#138808"}}/>
            </div>
          </div>

          {needs2fa ? (
            <form onSubmit={handleVerify2fa} className="space-y-4">
              <div className="text-center mb-2">
                <span className="text-3xl">🔐</span>
                <p className="text-sm text-white mt-2 font-medium">Enter your authenticator code</p>
                <p className="text-xs text-slate-500 mt-1">Open your authenticator app (Google Authenticator, Authy, etc.) for the 6-digit code.</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2.5 text-sm text-center tracking-widest outline-none focus:border-blue-500"
                placeholder="000000"
                autoFocus
              />
              {error && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400 text-center">⚠️ {error}</div>
              )}
              <button type="submit" disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold rounded-lg py-2.5 text-sm transition-all disabled:opacity-50">
                {loading ? "🔄 Verifying…" : "✅ Verify code"}
              </button>
              <button type="button" onClick={() => { setNeeds2fa(false); setCode(""); setError(""); }}
                className="w-full text-xs text-slate-500 hover:text-slate-300">
                ← Back to login
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">{t("login_username")}</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
                placeholder="Enter your username"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">{t("login_password")}</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors pr-10"
                  placeholder="Enter your password"
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs">
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400 text-center">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold rounded-lg py-2.5 text-sm transition-all disabled:opacity-50 mt-2"
            >
              {loading ? `🔄 ${t("login_signing_in")}` : `🔐 ${t("login_button")}`}
            </button>
          </form>
          )}

          <p className="text-center text-xs text-slate-500 mt-6">
            🔒 bcrypt password hashing · revocable server-side sessions · optional 2FA · hash-linked vote log
          </p>
        </div>

        <button onClick={() => navigate("/check-status")}
          className="w-full mt-3 text-xs bg-[#0b1529]/80 border border-[#1e3050] text-slate-400 hover:text-white rounded-xl py-2.5">
          🔍 I'm a voter — check my registration/voting status
        </button>

        <div className="mt-4 bg-[#0b1529]/80 border border-[#1e3050] rounded-xl p-4 text-xs text-slate-400">
          <p className="font-semibold text-slate-300 mb-2">Getting started</p>
          <p>
            First run, log in with <span className="text-blue-400 font-mono">admin</span> and the
            <span className="text-blue-400 font-mono"> SEED_ADMIN_PASSWORD</span> you set in your
            <span className="text-blue-400 font-mono"> .env</span> file, then change it and add
            your real voters/households from Settings.
          </p>
          <p className="mt-2 text-[10px] text-slate-500">
            No backend reachable? The app also runs fully offline with local sample data for testing —
            look for the "offline mode" badge if that happens.
          </p>
        </div>
      </div>
    </div>
  );
}
