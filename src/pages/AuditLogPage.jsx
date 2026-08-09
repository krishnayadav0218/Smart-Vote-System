import { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { getAuditLog } from "../lib/mockDb";
import { downloadCsv } from "../lib/csv";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const ACTION_COLOR = {
  LOGIN: "text-green-400",
  LOGIN_FAILED: "text-red-400",
  LOGOUT: "text-slate-400",
  VOTE_CAST: "text-blue-400",
  DUPLICATE_VOTE_BLOCKED: "text-red-400",
  VOTER_VERIFY_FAILED: "text-amber-400",
  VOTER_VERIFIED: "text-green-400",
  PASSWORD_CHANGED: "text-purple-400",
  VOTER_ADDED: "text-cyan-400",
  VOTERS_BULK_IMPORTED: "text-cyan-400",
  SETTINGS_UPDATED: "text-purple-400",
  OTP_ISSUED: "text-cyan-400",
};

export default function AuditLogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const token = localStorage.getItem("sv_token");
    axios.get(`${API}/api/admin/audit-log`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(({ data }) => { setEntries(data.entries); setLive(true); })
      .catch(() => { setEntries(getAuditLog()); setLive(false); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const exportCsv = () => downloadCsv("audit_log.csv", entries);

  if (user?.role !== "super_admin") {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center h-64 text-slate-500">
          <span className="text-4xl mb-3">🔒</span>
          <p className="text-lg">Super Admin only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Audit Log</h1>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">🔄 Refresh</button>
          <button onClick={exportCsv} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">⬇️ Export CSV</button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Every login, voter verification, vote cast, duplicate-vote block, and settings change — hash-linked so
        a missing or edited entry is detectable. Source: {live ? "live backend" : "offline demo data"}.
      </p>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 border-b border-[#1e3050]">
              <th className="p-3">Time</th>
              <th className="p-3">Action</th>
              <th className="p-3">Actor</th>
              <th className="p-3">Details</th>
              <th className="p-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-4 text-center text-slate-500">Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="p-4 text-center text-slate-500">No audit entries yet.</td></tr>
            ) : entries.map(e => (
              <tr key={e.id} className="border-b border-[#1e3050]/60 text-slate-300 font-mono">
                <td className="p-3 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                <td className={`p-3 ${ACTION_COLOR[e.action] || "text-slate-300"}`}>{e.action}</td>
                <td className="p-3">{e.actor || "—"}</td>
                <td className="p-3 max-w-[240px] truncate" title={e.details}>{e.details || "—"}</td>
                <td className="p-3 truncate max-w-[110px] text-slate-500" title={e.hash}>{e.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
