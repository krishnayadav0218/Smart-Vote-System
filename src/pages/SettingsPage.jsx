import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { getSettings, updateSettings, resetDemoData } from "../lib/mockDb";
import { useTheme } from "../context/ThemeContext";
import { useLang } from "../context/LangContext";

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

  // Local (offline demo) settings — used only when the real backend is unreachable
  const [localSettings, setLocalSettings] = useState(getSettings());
  const [live, setLive] = useState(false);

  // Real backend election settings
  const [remote, setRemote] = useState(null);
  const [loadingRemote, setLoadingRemote] = useState(true);

  const authHeaders = () => {
    const tok = localStorage.getItem("sv_token");
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  };

  const loadRemote = () => {
    axios.get(`${API}/api/admin/settings`, { headers: authHeaders() })
      .then(({ data }) => { setRemote(data); setLive(true); })
      .catch(() => setLive(false))
      .finally(() => setLoadingRemote(false));
  };

  useEffect(() => { loadRemote(); }, []); // eslint-disable-line

  const saveRemote = async (patch) => {
    try {
      await axios.post(`${API}/api/admin/settings`, patch, { headers: authHeaders() });
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
      await axios.post(`${API}/api/admin/voters`, voterForm, { headers: authHeaders() });
      toast.success(`Voter ${voterForm.id} added`);
      setVoterForm({ id: "", full_name: "", pin: "", constituency: "" });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable — voters must be added via the live server, not offline mode");
    } finally {
      setAddingVoter(false);
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
      const { data } = await axios.post(`${API}/api/admin/voters/bulk`, { csv: csvText }, { headers: authHeaders() });
      setImportResult(data);
      toast.success(`Imported ${data.added} voter(s), skipped ${data.skipped_existing} existing`);
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
    if (pwForm.next.length < 8) { toast.error("New password needs 8+ characters"); return; }
    setChangingPw(true);
    try {
      await axios.post(`${API}/api/auth/change-password`, { current_password: pwForm.current, new_password: pwForm.next }, { headers: authHeaders() });
      toast.success("Password changed");
      setPwForm({ current: "", next: "" });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backend not reachable");
    } finally {
      setChangingPw(false);
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

      {live && remote ? (
        <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Election configuration (live)</h2>
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
              className={`text-xs px-3 py-1.5 rounded-full border ${remote.voting_open ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}
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
          <p className="text-[10px] text-slate-500 mb-4">Leave both blank for no automatic window — only the Open/Closed toggle above will control it. Times are in your browser's local time.</p>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Voter verification method</p>
              <p className="text-xs text-slate-500">PIN = pre-shared code. OTP = one-time code generated per attempt (needs an operator to relay it — no SMS/email provider is wired up).</p>
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
            Connect the real backend (docker compose up) to unlock the voting-window and OTP options and to persist data beyond this browser.
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

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Add a voter (live backend)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Provision one real voter with a Voter ID + PIN. Requires the FastAPI backend running.
        </p>
        <form onSubmit={addVoter} className="grid grid-cols-2 gap-2">
          <input placeholder="Voter ID" value={voterForm.id} onChange={e=>setVoterForm(f=>({...f, id:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input placeholder="Full name" value={voterForm.full_name} onChange={e=>setVoterForm(f=>({...f, full_name:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input placeholder="PIN (4-6 digits)" value={voterForm.pin} onChange={e=>setVoterForm(f=>({...f, pin:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input placeholder="Constituency" value={voterForm.constituency} onChange={e=>setVoterForm(f=>({...f, constituency:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button type="submit" disabled={addingVoter} className="col-span-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm">
            {addingVoter ? "Adding…" : "+ Add voter"}
          </button>
        </form>
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Bulk-import voters (CSV)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Header row required: <code className="text-cyan-400">id,full_name,pin,constituency</code> (optional <code className="text-cyan-400">household_id</code> column). Existing Voter IDs are skipped, not overwritten.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleCsvFile}
          className="text-xs text-slate-400 mb-2 block" />
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={"id,full_name,pin,constituency\nV001,Asha Rao,1234,Ward 1\nV002,Ben Singh,5678,Ward 1"}
          rows={5}
          className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 mb-2"
        />
        <button onClick={runBulkImport} disabled={importing}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm">
          {importing ? "Importing…" : "⬆️ Import CSV"}
        </button>
        {importResult && (
          <div className="mt-3 text-xs text-slate-300">
            <p>✅ Added: {importResult.added} · Skipped (already existed): {importResult.skipped_existing}</p>
            {importResult.errors?.length > 0 && (
              <ul className="mt-1 text-red-400 list-disc list-inside">
                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Change admin password</h2>
        <p className="text-xs text-slate-500 mb-3">Change this before real election day — never keep the seeded default password.</p>
        <form onSubmit={changePassword} className="grid grid-cols-2 gap-2">
          <input type="password" placeholder="Current password" value={pwForm.current} onChange={e=>setPwForm(f=>({...f, current:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <input type="password" placeholder="New password (8+ chars)" value={pwForm.next} onChange={e=>setPwForm(f=>({...f, next:e.target.value}))}
            className="bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button type="submit" disabled={changingPw} className="col-span-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm">
            {changingPw ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>

      <div className="bg-[#0b1529] border border-red-500/20 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-red-300 mb-2">Danger zone (offline demo data only)</h2>
        <p className="text-xs text-slate-400 mb-3">
          Wipes the local demo dataset (households, blockchain, fraud alerts, audit log) and reseeds fresh sample data. Does not affect the real backend.
        </p>
        <button onClick={handleReset} className="text-xs bg-red-600/80 hover:bg-red-600 text-white px-3 py-2 rounded-lg">
          ⚠️ {t("settings_reset")}
        </button>
      </div>
    </div>
  );
}
