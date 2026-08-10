import { useState } from "react";
import { getBlocks, verifyChain } from "../lib/mockDb";
import { useLang } from "../context/LangContext";

export default function BlockchainPage() {
  const { t } = useLang();
  const [blocks, setBlocks] = useState(getBlocks());
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState(null);

  const runVerify = () => setChain(verifyChain());
  const refresh = () => setBlocks(getBlocks());

  const filtered = query
    ? blocks.filter(b => b.hash.includes(query) || String(b.voter_id || "").includes(query) || String(b.index) === query)
    : blocks;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">{t("chain_title")}</h1>
        <div className="flex gap-2">
          <button onClick={refresh} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">🔄 Refresh</button>
          <button onClick={runVerify} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg">✅ {t("chain_verify")}</button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        On-chain transaction log — eligibility / turnout only; ballots are anonymous. This demo uses a simple
        linked hash chain to illustrate tamper-evidence; it is not the same as a production blockchain.
      </p>

      {chain && (
        <div className={`text-xs rounded-lg px-3 py-2 mb-4 border ${chain.valid ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {chain.valid
            ? `Chain verified — all ${chain.blockCount} blocks link correctly, no hash mismatches.`
            : `Problems found: ${chain.problems.map(p => `block #${p.index} (${p.issue})`).join(", ")}`}
        </div>
      )}

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t("chain_search_placeholder")}
        className="bg-[#0b1529] border border-[#1e3050] rounded-lg px-3 py-2 text-sm text-white w-full max-w-md outline-none focus:border-blue-500 mb-4"
      />

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 border-b border-[#1e3050]">
              <th className="p-3">#</th>
              <th className="p-3">Timestamp</th>
              <th className="p-3">Voter ID</th>
              <th className="p-3">Constituency</th>
              <th className="p-3">Prev Hash</th>
              <th className="p-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-slate-500">No matching blocks.</td></tr>
            ) : filtered.map(b => (
              <tr key={b.index} className="border-b border-[#1e3050]/60 text-slate-300 font-mono">
                <td className="p-3">{b.index}</td>
                <td className="p-3">{new Date(b.timestamp).toLocaleString()}</td>
                <td className="p-3">{b.voter_id || <span className="text-slate-500">genesis</span>}</td>
                <td className="p-3">{b.constituency || "—"}</td>
                <td className="p-3 truncate max-w-[140px]" title={b.prev_hash}>{b.prev_hash.slice(0, 14)}…</td>
                <td className="p-3 truncate max-w-[140px] text-cyan-400" title={b.hash}>{b.hash.slice(0, 14)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
