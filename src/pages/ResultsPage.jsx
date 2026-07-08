import { useEffect, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ResultsPage() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${API}/api/blockchain/results`)
      .then(({ data }) => setResults(data.results || []))
      .catch(() => setError("Blockchain node se results fetch nahi ho paaye — hardhat node running hai check karein."))
      .finally(() => setLoading(false));
  }, []);

  const total = results.reduce((s, r) => s + (r.votes || 0), 0);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-white mb-1">Results — On-chain vote counts</h1>
      <p className="text-xs text-slate-500 mb-5">
        Every count here is read directly from the smart contract, verifiable by anyone running the node.
        Demo data — generic option labels, not tied to any real contest.
      </p>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3 mb-4">{error}</div>}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="space-y-3">
          {results.length === 0 && !error && (
            <p className="text-slate-500 text-sm">Abhi tak koi vote record nahi hai.</p>
          )}
          {results.map(r => {
            const pct = total ? Math.round((r.votes / total) * 1000) / 10 : 0;
            return (
              <div key={r.option} className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{r.option}</span>
                  <span className="text-sm text-slate-300">{r.votes} votes · {pct}%</span>
                </div>
                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
