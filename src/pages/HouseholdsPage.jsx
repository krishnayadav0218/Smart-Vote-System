import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function HouseholdsPage() {
  const [rows, setRows] = useState([]);
  const [constituency, setConstituency] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    axios.get(`${API}/api/households/`, { params: { constituency, limit: 50 } })
      .then(({ data }) => setRows(data.households))
      .catch(() => toast.error("Households load nahi ho paaye"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-white mb-1">Households — Aggregate Turnout</h1>
      <p className="text-xs text-slate-500 mb-4">
        Counts only. No member names, no vote-status per person, no ID numbers are exposed by this screen.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          value={constituency}
          onChange={e => setConstituency(e.target.value)}
          placeholder="Filter by constituency…"
          className="bg-[#0b1529] border border-[#1e3050] rounded-lg px-3 py-2 text-sm text-white flex-1 max-w-xs outline-none focus:border-blue-500"
        />
        <button onClick={load} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white">
          Search
        </button>
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-[#1e3050]">
              <th className="p-3">Household ID</th>
              <th className="p-3">Constituency</th>
              <th className="p-3">District</th>
              <th className="p-3">Members</th>
              <th className="p-3">Voted</th>
              <th className="p-3">Turnout</th>
              <th className="p-3">Verified</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-center text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-slate-500">Koi record nahi mila.</td></tr>
            ) : rows.map(hh => (
              <tr key={hh.id} className="border-b border-[#1e3050]/60 text-slate-300">
                <td className="p-3 font-mono text-xs">{hh.id}</td>
                <td className="p-3">{hh.constituency}</td>
                <td className="p-3">{hh.district}</td>
                <td className="p-3">{hh.member_count}</td>
                <td className="p-3">{hh.voted_count}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500" style={{ width: `${hh.turnout_pct}%` }} />
                    </div>
                    <span className="text-xs">{hh.turnout_pct}%</span>
                  </div>
                </td>
                <td className="p-3">
                  {hh.verified
                    ? <span className="text-green-400 text-xs">✓ Verified</span>
                    : <span className="text-slate-500 text-xs">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
