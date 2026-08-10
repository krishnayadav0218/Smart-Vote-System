import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { listHouseholds } from "../lib/mockDb";
import { downloadCsv } from "../lib/csv";
import { useLang } from "../context/LangContext";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const PAGE_SIZE = 10;

export default function HouseholdsPage() {
  const { t } = useLang();
  const [rows, setRows] = useState([]);
  const [constituency, setConstituency] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("id");
  const [sortDir, setSortDir] = useState("asc");

  const load = () => {
    setLoading(true);
    axios
      .get(`${API}/api/households/`, { params: { constituency, limit: 500 } })
      .then(({ data }) => setRows(data.households))
      .catch(() => setRows(listHouseholds({ constituency, limit: 500 }).households))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sortDir === "asc" ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const exportCsv = () => {
    if (sorted.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv("households_aggregate.csv", sorted);
    toast.success(`Exported ${sorted.length} rows`);
  };

  const cols = [
    { key: "id", label: "Household ID" },
    { key: "constituency", label: "Constituency" },
    { key: "district", label: "District" },
    { key: "member_count", label: "Members" },
    { key: "voted_count", label: "Voted" },
    { key: "turnout_pct", label: "Turnout" },
    { key: "verified", label: "Verified" },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">{t("hh_title")}</h1>
        <button onClick={exportCsv} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">
          ⬇️ {t("hh_export")}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Counts only. No member names, no vote-status per person, no ID numbers are exposed by this screen.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          value={constituency}
          onChange={e => setConstituency(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (setPage(1), load())}
          placeholder={t("hh_search_placeholder")}
          className="bg-[#0b1529] border border-[#1e3050] rounded-lg px-3 py-2 text-sm text-white flex-1 max-w-xs outline-none focus:border-blue-500"
        />
        <button onClick={() => { setPage(1); load(); }} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white">
          {t("hh_search")}
        </button>
      </div>

      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-[#1e3050]">
              {cols.map(c => (
                <th key={c.key} className="p-3 cursor-pointer select-none hover:text-slate-200" onClick={() => toggleSort(c.key)}>
                  {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-center text-slate-500">Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-slate-500">No records found.</td></tr>
            ) : pageRows.map(hh => (
              <tr key={hh.id} className="border-b border-[#1e3050]/60 text-slate-300">
                <td className="p-3 font-mono text-xs">{hh.id}</td>
                <td className="p-3">{hh.constituency}</td>
                <td className="p-3">{hh.district}</td>
                <td className="p-3">{hh.member_count}</td>
                <td className="p-3">{hh.voted_count}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full ${hh.turnout_pct > 100 ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${Math.min(hh.turnout_pct, 100)}%` }} />
                    </div>
                    <span className={`text-xs ${hh.turnout_pct > 100 ? "text-red-400 font-semibold" : ""}`}>{hh.turnout_pct}%</span>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
          <span>Page {page} of {totalPages} · {sorted.length} rows</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 rounded-lg bg-[#0b1529] border border-[#1e3050] disabled:opacity-40">← Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded-lg bg-[#0b1529] border border-[#1e3050] disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
