import { householdStats, getResults, getAuditLog, listHouseholds } from "../lib/mockDb";
import { downloadCsv } from "../lib/csv";
import { useLang } from "../context/LangContext";

export default function ReportsPage() {
  const { t } = useLang();
  const stats = householdStats();
  const results = getResults();
  const audit = getAuditLog();

  const exportTurnout = () => downloadCsv("turnout_summary.csv", listHouseholds({ limit: 1000 }).households);
  const exportResults = () => downloadCsv("results_summary.csv", results.map(r => ({ option: r.option, votes: r.votes })));
  const exportAudit = () => downloadCsv("audit_log.csv", audit.map(a => ({ id: a.id, ts: a.ts, action: a.action, actor: a.actor, details: a.details, hash: a.hash })));

  const reports = [
    { title: "Turnout Summary", desc: "Aggregate household turnout by constituency.", stat: `${stats.households} households · ${stats.turnout}% turnout`, action: exportTurnout },
    { title: "Results Summary", desc: "On-chain / demo-chain vote tally by option.", stat: `${results.reduce((s, r) => s + r.votes, 0)} total votes`, action: exportResults },
    { title: "Audit Log", desc: "Login, logout, and duplicate-vote-block events with hash chain.", stat: `${audit.length} entries`, action: exportAudit },
  ];

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-white mb-1">{t("reports_title")}</h1>
      <p className="text-xs text-slate-500 mb-5">
        Export aggregate reports as CSV. Use your browser's Print → Save as PDF for a printable copy of this page.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 print:hidden">
        {reports.map(r => (
          <div key={r.title} className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-5 flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{r.title}</h2>
              <p className="text-xs text-slate-400 mt-1">{r.desc}</p>
            </div>
            <p className="text-xs text-slate-500">{r.stat}</p>
            <button onClick={r.action} className="mt-auto text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg">
              ⬇️ Download CSV
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-[#0b1529] border border-[#1e3050] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Election summary (printable)</h2>
          <button onClick={() => window.print()} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg print:hidden">
            🖨️ {t("reports_print")}
          </button>
        </div>
        <div className="text-xs text-slate-300 grid grid-cols-2 gap-2">
          <p>Households tracked: <span className="text-white">{stats.households}</span></p>
          <p>Registered members: <span className="text-white">{stats.members}</span></p>
          <p>Votes cast (aggregate): <span className="text-white">{stats.voted}</span></p>
          <p>Turnout: <span className="text-white">{stats.turnout}%</span></p>
        </div>
        <table className="w-full text-xs mt-4">
          <thead>
            <tr className="text-left text-slate-400 border-b border-[#1e3050]">
              <th className="py-2">Option</th><th className="py-2">Votes</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => (
              <tr key={r.option} className="border-b border-[#1e3050]/60 text-slate-300">
                <td className="py-2">{r.symbol} {r.option}</td><td className="py-2">{r.votes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
