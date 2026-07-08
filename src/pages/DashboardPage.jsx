import { useEffect, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${color}`}>{sub}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${API}/api/households/`, { params: { limit: 1000 } })
      .then(({ data }) => {
        const totalMembers = data.households.reduce((s, h) => s + h.member_count, 0);
        const totalVoted   = data.households.reduce((s, h) => s + h.voted_count, 0);
        setStats({
          households: data.total,
          members: totalMembers,
          voted: totalVoted,
          turnout: totalMembers ? Math.round((totalVoted / totalMembers) * 1000) / 10 : 0,
        });
      })
      .catch(() => setError("Backend se connect nahi ho paaya — pehle API run karein."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <span className="text-[10px] px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
          Demo / Prototype data — not a live election
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-5">
        Aggregate-only view. Individual voter names or vote-status are never shown here — see Households page.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3 mb-4">{error}</div>
      )}
      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon="🏘️" label="Households / booths tracked" value={stats?.households ?? 0}
            sub="aggregate" color="border-blue-500/30 text-blue-300" />
          <StatCard icon="👥" label="Total registered members" value={stats?.members ?? 0}
            sub="aggregate" color="border-purple-500/30 text-purple-300" />
          <StatCard icon="✅" label="Votes cast (count only)" value={stats?.voted ?? 0}
            sub="no names" color="border-green-500/30 text-green-300" />
          <StatCard icon="📈" label="Turnout %" value={`${stats?.turnout ?? 0}%`}
            sub="aggregate" color="border-amber-500/30 text-amber-300" />
        </div>
      )}

      <div className="mt-6 bg-[#0b1529] border border-[#1e3050] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-2">Why no per-person data here?</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          This prototype deliberately shows only counts and percentages, never a named
          individual's vote status. Combining identity data with live "has this person
          voted yet" status enables door-to-door pressure and undermines secrecy of the
          ballot — so that capability was intentionally left out.
        </p>
      </div>
    </div>
  );
}
