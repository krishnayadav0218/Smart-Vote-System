import { useEffect, useState } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getResults, verifyChain } from "../lib/mockDb";
import { useLang } from "../context/LangContext";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ResultsPage() {
  const { t } = useLang();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [chain, setChain] = useState(null);
  const [liveRefresh, setLiveRefresh] = useState(false);

  const load = () => {
    setLoading(true);
    axios
      .get(`${API}/api/blockchain/results`)
      .then(({ data }) => { setResults(data.results || []); setSource("live on-chain data"); })
      .catch(() => { setResults(getResults()); setSource("offline demo hash-chain"); })
      .finally(() => {
        axios.get(`${API}/api/blockchain/verify`).then(({ data }) => setChain(data)).catch(() => setChain(verifyChain()));
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!liveRefresh) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [liveRefresh]);

  const total = results.reduce((s, r) => s + (r.votes || 0), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">{t("res_title")}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setLiveRefresh(v => !v)}
            className={`text-[10px] px-2 py-1 rounded-full border ${liveRefresh ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-[#1e3050] bg-[#111e35] text-slate-400"}`}>
            {liveRefresh ? "🟢 Live (10s)" : "⏸ Auto-refresh off"}
          </button>
          <button onClick={load} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">
            🔄 {t("res_refresh")}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Source: {source || "…"}. Demo data — generic option labels, not tied to any real contest.
      </p>
      {chain && (
        <div className={`text-xs rounded-lg px-3 py-2 mb-4 border ${chain.valid ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {chain.valid ? `⛓️ Chain verified — ${chain.blockCount} blocks, no broken links.` : `⚠️ Chain integrity problem detected across ${chain.problems.length} block(s).`}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <>
          {total > 0 && (
            <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 mb-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={results}>
                  <XAxis dataKey="option" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={0} angle={-10} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b1529", border: "1px solid #1e3050", fontSize: 12 }} />
                  <Bar dataKey="votes" radius={[4, 4, 0, 0]}>
                    {results.map((r, i) => <Cell key={i} fill={r.color || "#3b82f6"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="space-y-3">
            {results.length === 0 ? (
              <p className="text-slate-500 text-sm">No vote records yet.</p>
            ) : (
              results.map(r => {
                const pct = total ? Math.round((r.votes / total) * 1000) / 10 : 0;
                return (
                  <div key={r.option} className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-white">{r.symbol ? `${r.symbol} ` : ""}{r.option}</span>
                      <span className="text-sm text-slate-300">{r.votes} votes · {pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${pct}%`, background: r.color }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
