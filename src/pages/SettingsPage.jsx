import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { getSettings, updateSettings, resetDemoData } from "../lib/mockDb";
import { useTheme } from "../context/ThemeContext";
import { useLang } from "../context/LangContext";
import { useAuth } from "../context/AuthContext";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { lang, setLanguage, t } = useLang();
  const { offline } = useAuth();

  const [localSettings, setLocalSettings] = useState(getSettings());
  const [remote, setRemote] = useState(null);
  const [loadingRemote, setLoadingRemote] = useState(true);
  const live = !offline && !!remote;

  const loadRemote = () => {
    axios.get(`${API}/api/admin/settings`)
      .then(({ data }) => setRemote(data))
      .catch(() => setRemote(null))
      .finally(() => setLoadingRemote(false));
  };

  useEffect(() => { loadRemote(); }, []); // eslint-disable-line

  const saveRemote = async (patch) => {
    try {
      await axios.post(`${API}/api/admin/settings`, patch);
      setRemote((r) => ({ ...r, ...patch }));
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not save — backend unreachable?");
    }
  };

  const saveLocal = (patch) => {
    const next = updateSettings(patch);
    setLocalSettings(next);
    toast.success("Settings saved (offline demo data)");
  };

  const handleReset = () => {
    if (!window.confirm("This will wipe all local demo data (households, blockchain, alerts, audit log) and reseed fresh sample data. Continue?")) return;
    resetDemoData();
    setLocalSettings(getSettings());
    toast.success("Demo data reset");
  };

  // --- Voter provisioning ---
  const [voterForm, setVoterForm] = useState({ id: "", full_name: "", pin: "", constituency: "" });
  const [addingVoter, setAddingVoter] = useState(false);

  const addVoter = async (e) => {
    e.preventDefault();
    if (!voterForm.id || !voterForm.full_name || !voterForm.pin || !voterForm.constituency) {
      toast.error("Fill every field"); return;
    }
    setAddingVoter(true);
    try {
      await axios.post(`${API}/api/admin/voters`, voterForm);
      toast.success(`Voter ${voterForm.id} added`);
      setVoterForm({ id: "", full_name: "", pin: "", constituency: "" });
      loadVoters();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable — voters must be added via the live server, not offline mode");
    } finally {
      setAddingVoter(false);
    }
  };

  // --- Voter list / manage ---
  const [voters, setVoters] = useState([]);
  const loadVoters = () => {
    axios.get(`${API}/api/admin/voters`).then(({ data }) => setVoters(data.voters)).catch(() => setVoters([]));
  };
  useEffect(() => { loadVoters(); }, []);

  const deleteVoter = async (id) => {
    if (!window.confirm(`Delete voter ${id}? Only allowed if they haven't voted yet.`)) return;
    try {
      await axios.delete(`${API}/api/admin/voters/${id}`);
      toast.success("Voter deleted");
      loadVoters();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not delete");
    }
  };

  const resetPin = async (id) => {
    const newPin = window.prompt(`New PIN for ${id} (4-8 digits, not a repeated/sequential pattern):`);
    if (!newPin) return;
    try {
      await axios.post(`${API}/api/admin/voters/${id}/reset-pin`, { new_pin: newPin });
      toast.success("PIN reset");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not reset PIN");
    }
  };

  // --- Bulk CSV import ---
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target.result);
    reader.readAsText(file);
  };

  const runBulkImport = async () => {
    if (!csvText.trim()) { toast.error("Paste or upload CSV first"); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const { data } = await axios.post(`${API}/api/admin/voters/bulk`, { csv: csvText });
      setImportResult(data);
      toast.success(`Imported ${data.added} voter(s), skipped ${data.skipped_existing} existing`);
      loadVoters();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable");
    } finally {
      setImporting(false);
    }
  };

  // --- Admin password change ---
  const [pwForm, setPwForm] = useState({ current: "", next: "" });
  const [changingPw, setChangingPw] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    setChangingPw(true);
    try {
      await axios.post(`${API}/api/auth/change-password`, { current_password: pwForm.current, new_password: pwForm.next });
      toast.success("Password changed — you'll need to log in again on other devices");
      setPwForm({ current: "", next: "" });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable");
    } finally {
      setChangingPw(false);
    }
  };

  // --- 2FA setup ---
  const [me, setMe] = useState(null);
  const [twoFa, setTwoFa] = useState(null); // { secret, provisioning_uri } while setting up
  const [twoFaCode, setTwoFaCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const loadMe = () => axios.get(`${API}/api/auth/me`).then(({ data }) => setMe(data)).catch(() => setMe(null));
  useEffect(() => { loadMe(); }, []);

  const start2fa = async () => {
    try {
      const { data } = await axios.post(`${API}/api/auth/2fa/setup`);
      setTwoFa(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable");
    }
  };

  const confirm2fa = async () => {
    try {
      await axios.post(`${API}/api/auth/2fa/enable`, { code: twoFaCode });
      toast.success("2FA enabled — you'll need your authenticator app on future logins");
      setTwoFa(null); setTwoFaCode("");
      loadMe();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Incorrect code");
    }
  };

  const disable2fa = async () => {
    try {
      await axios.post(`${API}/api/auth/2fa/disable`, { code: disableCode });
      toast.success("2FA disabled");
      setDisableCode("");
      loadMe();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Incorrect code");
    }
  };

  const logoutAllSessions = async () => {
    if (!window.confirm("Log out of every device/browser using this admin account?")) return;
    try {
      await axios.post(`${API}/api/auth/logout-all-sessions`);
      toast.success("All sessions logged out — you'll need to log back in here too");
      window.location.href = "/login";
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable");
    }
  };

  // --- Finalize / certify election ---
  const [finalizeText, setFinalizeText] = useState("");
  const [finalizing, setFinalizing] = useState(false);

  const finalizeElection = async () => {
    if (finalizeText !== "FINALIZE") { toast.error('Type "FINALIZE" exactly to confirm'); return; }
    if (!window.confirm("This permanently closes voting and certifies results. This cannot be undone. Continue?")) return;
    setFinalizing(true);
    try {
      await axios.post(`${API}/api/admin/finalize`, { confirm: finalizeText });
      toast.success("Election finalized — results certified");
      setFinalizeText("");
      loadRemote();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not finalize");
    } finally {
      setFinalizing(false);
    }
  };

  // --- Household bulk import ---
  const [hhCsvText, setHhCsvText] = useState("");
  const [hhImporting, setHhImporting] = useState(false);
  const [hhImportResult, setHhImportResult] = useState(null);

  const handleHhCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setHhCsvText(ev.target.result);
    reader.readAsText(file);
  };

  const runHhBulkImport = async () => {
    if (!hhCsvText.trim()) { toast.error("Paste or upload CSV first"); return; }
    setHhImporting(true);
    setHhImportResult(null);
    try {
      const { data } = await axios.post(`${API}/api/admin/households/bulk`, { csv: hhCsvText });
      setHhImportResult(data);
      toast.success(`Imported ${data.added} household(s), skipped ${data.skipped_existing} existing`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable");
    } finally {
      setHhImporting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">{t("settings_title")}</h1>
        <span className={`text-[10px] px-2 py-1 rounded-full border ${live ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
          {loadingRemote ? "checking backend…" : live ? "🟢 live backend connected" : "🟠 offline demo mode"}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-5">Election configuration and system preferences.</p>

      {live ? (
        <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Election configuration (live)</h2>
          {remote.finalized && (
            <div className="mb-4 bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-2 text-xs text-purple-300">
              🔒 Results certified — finalized {new Date(remote.finalized_at).toLocaleString()} by {remote.finalized_by}. Voting cannot be reopened.
            </div>
          )}
          <label className="block text-xs text-slate-400 mb-1.5">{t("settings_election_name")}</label>
          <input
            defaultValue={remote.election_name}
            onBlur={e => saveRemote({ election_name: e.target.value })}
            className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 mb-4"
          />

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-white">{t("settings_voting_status")}</p>
              <p className="text-xs text-slate-500">Toggling this closes/opens the EVM ballot for new votes.</p>
            </div>
            <button
              onClick={() => saveRemote({ voting_open: !remote.voting_open })}
              disabled={remote.finalized}
              className={`text-xs px-3 py-1.5 rounded-full border disabled:opacity-40 ${remote.voting_open ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}
            >
              {remote.voting_open ? "🟢 Open" : "🔴 Closed"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Voting opens at (optional)</label>
              <input type="datetime-local" defaultValue={toLocalInputValue(remote.voting_start)}
                onBlur={e => saveRemote({ voting_start: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Voting closes at (optional)</label>
              <input type="datetime-local" defaultValue={toLocalInputValue(remote.voting_end)}
                onBlur={e => saveRemote({ voting_end: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mb-4">Leave both blank for no automatic window. Times are in your browser's local time.</p>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Voter verification method</p>
              <p className="text-xs text-slate-500">PIN = pre-shared code. OTP = one-time code per attempt (needs an operator to relay it — no SMS/email provider wired up).</p>
            </div>
            <div className="flex gap-2">
              {["pin", "otp"].map(m => (
                <button key={m} onClick={() => saveRemote({ verification_mode: m })}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${remote.verification_mode === m ? "border-blue-500 bg-blue-500/15 text-blue-300" : "border-[#1e3050] bg-[#111e35] text-slate-400"}`}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Election configuration (offline demo)</h2>
          <label className="block text-xs text-slate-400 mb-1.5">{t("settings_election_name")}</label>
          <input
            defaultValue={localSettings.electionName}
            onBlur={e => saveLocal({ electionName: e.target.value })}
            className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 mb-4"
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-white">{t("settings_voting_status")}</p>
            <button
              onClick={() => saveLocal({ votingOpen: !localSettings.votingOpen })}
              className={`text-xs px-3 py-1.5 rounded-full border ${localSettings.votingOpen ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}
            >
              {localSettings.votingOpen ? "🟢 Open" : "🔴 Closed"}
            </button>
          </div>
          <p className="text-[10px] text-amber-400/80 mt-3">
            Connect the real backend (docker compose up) to unlock voting-window, OTP, 2FA, and voter management.
          </p>
        </div>
      )}

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-3">Preferences</h2>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-white">{t("settings_theme")}</p>
          <button onClick={toggleTheme} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">
            {theme === "dark" ? "🌙 Dark" : "☀️ Light"} — switch
          </button>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-white">{t("settings_language")}</p>
          <div className="flex gap-2">
            {["en", "hi"].map(l => (
              <button key={l} onClick={() => setLanguage(l)}
                className={`text-xs px-3 py-1.5 rounded-lg border ${lang === l ? "border-blue-500 bg-blue-500/15 text-blue-300" : "border-[#1e3050] bg-[#111e35] text-slate-400"}`}>
                {l === "en" ? "English" : "हिन्दी"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* --- Two-factor authentication --- */}
      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-white">Two-factor authentication (admin login)</h2>
          {me && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${me.totp_enabled ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-slate-500/30 bg-slate-500/10 text-slate-400"}`}>
              {me.totp_enabled ? "Enabled" : "Disabled"}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Adds an authenticator-app code on top of your password for admin logins. Strongly recommended before election day.
        </p>

        {!me?.totp_enabled && !twoFa && (
          <button onClick={start2fa} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg">
            + Set up 2FA
          </button>
        )}

        {twoFa && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Add this to Google Authenticator / Authy manually (no camera QR here — paste the secret as a "setup key"):
            </p>
            <div className="bg-[#111e35] border border-[#1e3050] rounded-lg p-3 font-mono text-xs text-cyan-400 break-all">{twoFa.secret}</div>
            <input value={twoFaCode} onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter the 6-digit code to confirm" maxLength={6}
              className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <button onClick={confirm2fa} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-sm">
              Confirm & enable
            </button>
          </div>
        )}

        {me?.totp_enabled && (
          <div className="space-y-2">
            <input value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter current code to disable" maxLength={6}
              className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <button onClick={disable2fa} className="bg-red-600/80 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-sm">
              Disable 2FA
            </button>
          </div>
        )}
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Add a voter (live backend)</h2>
        <p className="text-xs text-slate-500 mb-3">Provision one real voter with a Voter ID + PIN.</p>
        <form onSubmit={addVoter} className="grid grid-cols-2 gap-2">
          <input placeholder="Voter ID" value={voterForm.id} onChange={e=>setVoterForm(f=>({...f, id:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input placeholder="Full name" value={voterForm.full_name} onChange={e=>setVoterForm(f=>({...f, full_name:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input placeholder="PIN (4-8 digits, not 1234/1111 etc.)" value={voterForm.pin} onChange={e=>setVoterForm(f=>({...f, pin:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input placeholder="Constituency" value={voterForm.constituency} onChange={e=>setVoterForm(f=>({...f, constituency:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button type="submit" disabled={addingVoter} className="col-span-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm">
            {addingVoter ? "Adding…" : "+ Add voter"}
          </button>
        </form>
      </div>

      {voters.length > 0 && (
        <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Manage voters ({voters.length})</h2>
          <div className="max-h-64 overflow-y-auto space-y-1.5">
            {voters.map(v => (
              <div key={v.id} className="flex items-center justify-between bg-[#111e35] border border-[#1e3050] rounded-lg px-3 py-2 text-xs">
                <div>
                  <span className="text-white font-mono">{v.id}</span>
                  <span className="text-slate-400 ml-2">{v.full_name}</span>
                  <span className="text-slate-500 ml-2">{v.constituency}</span>
                  {v.has_voted && <span className="ml-2 text-green-400">✓ voted</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => resetPin(v.id)} className="text-blue-400 hover:text-blue-300">Reset PIN</button>
                  {!v.has_voted && <button onClick={() => deleteVoter(v.id)} className="text-red-400 hover:text-red-300">Delete</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Bulk-import voters (CSV)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Header row required: <code className="text-cyan-400">id,full_name,pin,constituency</code> (optional <code className="text-cyan-400">household_id</code>). Existing IDs are skipped; weak PINs are rejected per-row.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="text-xs text-slate-400 mb-2 block" />
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={"id,full_name,pin,constituency\nV001,Asha Rao,4826,Ward 1\nV002,Ben Singh,7351,Ward 1"}
          rows={5}
          className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 mb-2"
        />
        <button onClick={runBulkImport} disabled={importing}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm">
          {importing ? "Importing…" : "⬆️ Import CSV"}
        </button>
        {importResult && (
          <div className="mt-3 text-xs text-slate-300">
            <p>✅ Added: {importResult.added} · Skipped (existing): {importResult.skipped_existing} · Weak PINs rejected: {importResult.weak_pins_skipped}</p>
            {importResult.errors?.length > 0 && (
              <ul className="mt-1 text-red-400 list-disc list-inside max-h-32 overflow-y-auto">
                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Change admin password</h2>
        <p className="text-xs text-slate-500 mb-3">Requires 8+ chars mixing at least two of: upper/lowercase, digits, symbols. Invalidates other sessions.</p>
        <form onSubmit={changePassword} className="grid grid-cols-2 gap-2">
          <input type="password" placeholder="Current password" value={pwForm.current} onChange={e=>setPwForm(f=>({...f, current:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input type="password" placeholder="New password" value={pwForm.next} onChange={e=>setPwForm(f=>({...f, next:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button type="submit" disabled={changingPw} className="col-span-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm">
            {changingPw ? "Saving…" : "Change password"}
          </button>
        </form>
        <button onClick={logoutAllSessions} className="mt-3 text-xs text-slate-400 hover:text-white underline">
          Log out of all devices/sessions
        </button>
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Bulk-import households (CSV)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Header row required: <code className="text-cyan-400">id,constituency,district,member_count</code>. Used for aggregate turnout tracking on the Households page.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleHhCsvFile} className="text-xs text-slate-400 mb-2 block" />
        <textarea
          value={hhCsvText}
          onChange={e => setHhCsvText(e.target.value)}
          placeholder={"id,constituency,district,member_count\nHH-0001,Ward 1,North,5\nHH-0002,Ward 1,North,3"}
          rows={4}
          className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 mb-2"
        />
        <button onClick={runHhBulkImport} disabled={hhImporting}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm">
          {hhImporting ? "Importing…" : "⬆️ Import CSV"}
        </button>
        {hhImportResult && (
          <div className="mt-3 text-xs text-slate-300">
            <p>✅ Added: {hhImportResult.added} · Skipped (existing): {hhImportResult.skipped_existing}</p>
            {hhImportResult.errors?.length > 0 && (
              <ul className="mt-1 text-red-400 list-disc list-inside max-h-32 overflow-y-auto">
                {hhImportResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {live && !remote.finalized && (
        <div className="bg-[#0b1529] border border-purple-500/20 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-purple-300 mb-2">Finalize & certify election</h2>
          <p className="text-xs text-slate-400 mb-3">
            Permanently closes voting and certifies the results. Use this once polls have closed and you've checked
            turnout/results — it cannot be undone from here (start a fresh election instead if you need to redo it).
          </p>
          <div className="flex gap-2">
            <input value={finalizeText} onChange={e => setFinalizeText(e.target.value)}
              placeholder='Type "FINALIZE" to confirm'
              className="flex-1 bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500" />
            <button onClick={finalizeElection} disabled={finalizing}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm whitespace-nowrap">
              {finalizing ? "Finalizing…" : "🔒 Finalize"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#0b1529] border border-red-500/20 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-red-300 mb-2">Danger zone (offline demo data only)</h2>
        <p className="text-xs text-slate-400 mb-3">
          Wipes the local demo dataset and reseeds fresh sample data. Does not affect the real backend.
        </p>
        <button onClick={handleReset} className="text-xs bg-red-600/80 hover:bg-red-600 text-white px-3 py-2 rounded-lg">
          ⚠️ {t("settings_reset")}
        </button>
      </div>
    </div>
  );
}
