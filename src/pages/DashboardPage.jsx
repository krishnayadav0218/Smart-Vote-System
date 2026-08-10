import { useEffect, useState } from "react";
import axios from "axios";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { householdStats, getResults, getFraudAlerts } from "../lib/mockDb";
import { useLang } from "../context/LangContext";

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
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [byConstituency, setByConstituency] = useState([]);
  const [results, setResults] = useState([]);
  const [alertCount, setAlertCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("api");
  const [liveRefresh, setLiveRefresh] = useState(false);

  const load = () => {
    axios
      .get(`${API}/api/households/`, { params: { limit: 1000 } })
      .then(({ data }) => {
        const totalMembers = data.households.reduce((s, h) => s + h.member_count, 0);
        const totalVoted = data.households.reduce((s, h) => s + h.voted_count, 0);
        setStats({
          households: data.total,
          members: totalMembers,
          voted: totalVoted,
          turnout: totalMembers ? Math.round((totalVoted / totalMembers) * 1000) / 10 : 0,
        });
        setSource("api");
      })
      .catch(() => {
        const s = householdStats();
        setStats(s);
        setByConstituency(s.byConstituency);
        setSource("offline demo data");
      })
      .finally(() => {
        axios.get(`${API}/api/blockchain/results`).then(({ data }) => setResults(data.results || [])).catch(() => setResults(getResults()));
        setAlertCount(getFraudAlerts().filter((a) => !a.reviewed).length);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!liveRefresh) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [liveRefresh]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">{t("dash_title")}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setLiveRefresh(v => !v)}
            className={`text-[10px] px-2 py-1 rounded-full border ${liveRefresh ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-[#1e3050] bg-[#111e35] text-slate-400"}`}>
            {liveRefresh ? "🟢 Live (10s)" : "⏸ Auto-refresh off"}
          </button>
          <span className="text-[10px] px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
            Demo / Prototype data — not a live election ({source})
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-5">
        Aggregate-only view. Individual voter names or vote-status are never shown here — see Households page.
      </p>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard icon="🏘️" label={t("dash_households")} value={stats?.households ?? 0}
              sub="aggregate" color="border-blue-500/30 text-blue-300" />
            <StatCard icon="👥" label={t("dash_members")} value={stats?.members ?? 0}
              sub="aggregate" color="border-purple-500/30 text-purple-300" />
            <StatCard icon="✅" label={t("dash_voted")} value={stats?.voted ?? 0}
              sub="no names" color="border-green-500/30 text-green-300" />
            <StatCard icon="📈" label={t("dash_turnout")} value={`${stats?.turnout ?? 0}%`}
              sub="aggregate" color="border-amber-500/30 text-amber-300" />
            <StatCard icon="🚨" label={t("dash_alerts")} value={alertCount}
              sub={alertCount ? "review needed" : "clear"}
              color={alertCount ? "border-red-500/30 text-red-300" : "border-slate-500/30 text-slate-400"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            {byConstituency.length > 0 && (
              <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white mb-3">{t("dash_turnout_by_area")}</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byConstituency}>
                    <XAxis dataKey="constituency" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "#0b1529", border: "1px solid #1e3050", fontSize: 12 }} />
                    <Bar dataKey="turnout" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">{t("dash_vote_share")}</h2>
              {results.reduce((s, r) => s + r.votes, 0) === 0 ? (
                <p className="text-xs text-slate-500">No votes cast yet — try the EVM Machine page.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={results} dataKey="votes" nameKey="option" innerRadius={45} outerRadius={80} paddingAngle={2}>
                      {results.map((r) => <Cell key={r.party_id} fill={r.color} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Tooltip contentStyle={{ background: "#0b1529", border: "1px solid #1e3050", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
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
