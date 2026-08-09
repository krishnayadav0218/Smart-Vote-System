import { useState } from "react";
import toast from "react-hot-toast";
import { runFraudScan, getFraudAlerts, markAlertReviewed } from "../lib/mockDb";
import { useLang } from "../context/LangContext";

const SEVERITY_STYLE = {
  critical: "border-red-500/30 bg-red-500/10 text-red-300",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  low: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

export default function FraudPage() {
  const { t } = useLang();
  const [alerts, setAlerts] = useState(getFraudAlerts());
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState("all");

  const runScan = async () => {
    setScanning(true);
    await new Promise(r => setTimeout(r, 700)); // brief UX delay so "scanning" feels real
    const res = runFraudScan();
    setAlerts(getFraudAlerts());
    setScanning(false);
    toast.success(`Scan complete — ${res.newAlertsFound} new alert(s) of ${res.scanned} households checked.`);
  };

  const review = (id) => {
    markAlertReviewed(id);
    setAlerts(getFraudAlerts());
  };

  const shown = filter === "all" ? alerts : alerts.filter(a => (filter === "open" ? !a.reviewed : a.reviewed));
  const openCount = alerts.filter(a => !a.reviewed).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">{t("fraud_title")}</h1>
        <button onClick={runScan} disabled={scanning}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
          {scanning ? `🔍 ${t("fraud_scanning")}` : `🔍 ${t("fraud_run_scan")}`}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Simple, explainable rules only — impossible turnout ({">"}100%), unverified households at 100% turnout,
        unusually high turnout, and blocked duplicate-vote attempts. No individual voter targeting; every flag
        is reviewable and traceable to a rule.
      </p>

      <div className="flex gap-2 mb-4">
        {["all", "open", "reviewed"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border ${filter === f ? "bg-blue-500/15 border-blue-500 text-blue-300" : "bg-[#0b1529] border-[#1e3050] text-slate-400"}`}>
            {f === "all" ? `All (${alerts.length})` : f === "open" ? `Open (${openCount})` : `Reviewed (${alerts.length - openCount})`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.length === 0 ? (
          <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-6 text-center text-slate-500 text-sm">
            No alerts in this view. Run a scan to check the current demo dataset.
          </div>
        ) : shown.map(a => (
          <div key={a.id} className={`rounded-xl p-4 border flex items-start justify-between gap-3 ${SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.low}`}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase font-bold tracking-wide">{a.severity}</span>
                <span className="text-[10px] text-slate-400">{a.type.replace(/_/g, " ")}</span>
                <span className="text-[10px] text-slate-500">{new Date(a.ts).toLocaleString()}</span>
              </div>
              <p className="text-sm text-white">{a.message}</p>
            </div>
            {!a.reviewed && (
              <button onClick={() => review(a.id)} className="text-xs bg-[#111e35] border border-[#1e3050] text-slate-300 hover:text-white px-3 py-1.5 rounded-lg whitespace-nowrap">
                Mark reviewed
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
