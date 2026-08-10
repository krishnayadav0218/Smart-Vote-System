import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function CheckStatusPage() {
  const navigate = useNavigate();
  const [voterId, setVoterId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = async (e) => {
    e.preventDefault();
    if (!voterId.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const { data } = await axios.get(`${API}/api/votes/lookup`, { params: { voter_id: voterId.trim() } });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not reach the server — try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#060d1f] via-[#0b1529] to-[#060d1f] p-4">
      <div className="w-full max-w-sm bg-[#0b1529] border border-[#1e3050] rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <span className="text-3xl">🗳️</span>
          <h1 className="text-lg font-bold text-white mt-2">Check my voter status</h1>
          <p className="text-xs text-slate-400 mt-1">
            Enter your Voter ID to see if you're registered and whether you've already voted.
            No PIN needed — this only shows status, nothing personal.
          </p>
        </div>

        <form onSubmit={check} className="space-y-3">
          <input
            value={voterId}
            onChange={e => setVoterId(e.target.value)}
            placeholder="Enter your Voter ID"
            className="w-full bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            autoFocus
          />
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold">
            {loading ? "Checking…" : "Check status"}
          </button>
        </form>

        {error && (
          <div className="mt-4 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400 text-center">⚠️ {error}</div>
        )}

        {result && (
          <div className={`mt-4 rounded-lg px-4 py-3 text-sm border ${result.registered ? "border-blue-500/30 bg-blue-500/10" : "border-slate-500/30 bg-slate-500/10"}`}>
            {result.registered ? (
              <>
                <p className="text-white">✅ You're registered to vote.</p>
                <p className={`mt-1 ${result.has_voted ? "text-green-400" : "text-amber-400"}`}>
                  {result.has_voted ? "You've already cast your vote." : "You haven't voted yet."}
                </p>
              </>
            ) : (
              <p className="text-slate-300">No record found for that Voter ID. Contact the election operator.</p>
            )}
          </div>
        )}

        <button onClick={() => navigate("/login")} className="w-full text-xs text-slate-500 hover:text-slate-300 mt-6">
          ← Back to admin login
        </button>
      </div>
    </div>
  );
}
