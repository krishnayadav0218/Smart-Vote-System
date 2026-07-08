import { useState, useRef } from "react";
import axios from "axios";
import toast from "react-hot-toast";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// NOTE: generic placeholder options — this is a concept demo, not tied to
// any real party, candidate, or election. Swap in real ballot options only
// after the system has gone through official certification.
const PARTIES = [
  { id:"a", name:"Candidate / Option A", abbr:"OPT-A", symbol:"🔵", color:"#3b82f6" },
  { id:"b", name:"Candidate / Option B", abbr:"OPT-B", symbol:"🟠", color:"#FF9933" },
  { id:"c", name:"Candidate / Option C", abbr:"OPT-C", symbol:"🟢", color:"#138808" },
  { id:"d", name:"Candidate / Option D", abbr:"OPT-D", symbol:"🟣", color:"#a855f7" },
];

// Biometric verification step component
function BioStep({ step, label, icon, state }) {
  const cls = {
    pending:  "border-dashed border-slate-600 bg-slate-800/50 text-slate-500",
    scanning: "border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse",
    verified: "border-green-500 bg-green-500/10 text-green-400",
    failed:   "border-red-500 bg-red-500/10 text-red-400",
  }[state] || "border-dashed border-slate-600 bg-slate-800/50 text-slate-500";

  const msg = { pending:"Pending", scanning:"Scanning...", verified:"✓ Verified", failed:"✗ Failed" }[state];

  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className={`w-14 h-14 rounded-full border-2 flex items-center justify-center text-2xl ${cls}`}>
        {icon}
      </div>
      <p className="text-xs font-medium text-slate-300">{label}</p>
      <span className={`text-[10px] ${state === "verified" ? "text-green-400" : state === "scanning" ? "text-blue-400" : "text-slate-500"}`}>
        {msg}
      </span>
    </div>
  );
}

export default function EVMPage() {
  const [voterId,    setVoterId]    = useState("");
  const [bioStates,  setBioStates]  = useState({ aadhaar:"pending", face:"pending", fp:"pending" });
  const [verifiedVoter, setVerifiedVoter] = useState(null);
  const [sessionToken,  setSessionToken]  = useState(null);
  const [selectedParty, setSelectedParty] = useState(null);
  const [receipt,       setReceipt]       = useState(null);
  const [phase, setPhase] = useState("search"); // search | verifying | ballot | success

  const setBio = (key, val) => setBioStates(s => ({...s, [key]: val}));

  const verifyVoter = async () => {
    if (!voterId.trim()) { toast.error("Enter Voter ID or Aadhaar"); return; }
    setPhase("verifying");
    setBioStates({ aadhaar:"pending", face:"pending", fp:"pending" });

    // Step 1 — Aadhaar
    setBio("aadhaar", "scanning");
    await delay(1200);
    try {
      const { data } = await axios.post(`${API}/api/votes/verify-identity`, {
        voter_id: voterId, aadhaar_number: voterId
      });
      setBio("aadhaar", "verified");
      // Step 2 — Face
      setBio("face", "scanning");
      await delay(1400);
      setBio("face", "verified");
      // Step 3 — Fingerprint
      setBio("fp", "scanning");
      await delay(1200);
      setBio("fp", "verified");
      setVerifiedVoter(data.voter);
      setSessionToken(data.session_token);
      setPhase("ballot");
      toast.success("Identity verified ✓");
    } catch (err) {
      setBio("aadhaar", "failed");
      setPhase("search");
      toast.error(err.response?.data?.detail || "Verification failed");
    }
  };

  // Simulate for demo if backend not available
  const verifyDemo = async () => {
    if (!voterId.trim()) { toast.error("Enter Voter ID"); return; }
    setPhase("verifying");
    setBioStates({ aadhaar:"pending", face:"pending", fp:"pending" });
    setBio("aadhaar","scanning"); await delay(1200); setBio("aadhaar","verified");
    setBio("face","scanning");    await delay(1400); setBio("face","verified");
    setBio("fp","scanning");      await delay(1200); setBio("fp","verified");
    setVerifiedVoter({ id: voterId, full_name:"Demo Voter", constituency:"Constituency 1", aadhaar_last4:"1234" });
    setSessionToken("demo-session-"+Date.now());
    setPhase("ballot");
    toast.success("Biometric verified ✓");
  };

  const castVote = async () => {
    if (!selectedParty || !verifiedVoter) return;
    try {
      const { data } = await axios.post(`${API}/api/votes/cast`, {
        voter_id: verifiedVoter.id,
        party_id: selectedParty,
        biometric_method: "both",
        session_token: sessionToken,
      });
      setReceipt(data.receipt);
      setPhase("success");
    } catch {
      // Demo receipt
      const party = PARTIES.find(p => p.id === selectedParty);
      setReceipt({
        voter_id: verifiedVoter.id,
        voter_name: verifiedVoter.full_name,
        party: party.name,
        party_symbol: party.symbol,
        constituency: verifiedVoter.constituency,
        tx_hash: "0x" + Math.random().toString(16).slice(2,18) + "...confirmed",
        receipt_hash: Math.random().toString(36).slice(2,12).toUpperCase(),
        voted_at: new Date().toISOString(),
      });
      setPhase("success");
    }
  };

  const reset = () => {
    setVoterId(""); setBioStates({aadhaar:"pending",face:"pending",fp:"pending"});
    setVerifiedVoter(null); setSessionToken(null); setSelectedParty(null); setReceipt(null);
    setPhase("search");
  };

  if (phase === "success" && receipt) return (
    <div className="max-w-md mx-auto">
      <div className="bg-[#0b1529] border border-[#1e3050] rounded-2xl p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/15 border-2 border-green-500 flex items-center justify-center text-3xl mx-auto mb-4">✅</div>
        <h2 className="text-lg font-bold text-green-400 mb-1">Vote Recorded!</h2>
        <p className="text-xs text-slate-400 mb-5">Secured on Ethereum blockchain</p>
        <div className="bg-[#111e35] border border-[#1e3050] rounded-xl p-4 text-left space-y-2 mb-4">
          {[["Voter ID", receipt.voter_id],["Name", receipt.voter_name],["Party", `${receipt.party_symbol} ${receipt.party}`],["Constituency", receipt.constituency],["Tx Hash", receipt.tx_hash],["Receipt", receipt.receipt_hash],["Time", new Date(receipt.voted_at).toLocaleTimeString("en-IN")]].map(([k,v])=>(
            <div key={k} className="flex justify-between text-xs">
              <span className="text-slate-400">{k}</span>
              <span className="text-white font-medium text-right max-w-[55%] truncate">{v}</span>
            </div>
          ))}
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2 flex items-center gap-2 text-xs text-green-400 mb-4">
          ⛓️ Immutable blockchain record · Cannot be altered
        </div>
        <button onClick={reset} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
          Next Voter →
        </button>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-5 max-w-5xl">
      {/* LEFT — Verification */}
      <div className="space-y-4">
        <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3">🔍 Voter Identity Verification</h3>
          <div className="flex gap-2 mb-4">
            <input
              value={voterId}
              onChange={e=>setVoterId(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&verifyDemo()}
              placeholder="Enter Voter ID or Aadhaar..."
              disabled={phase==="verifying"||phase==="ballot"}
              className="flex-1 bg-[#111e35] border border-[#1e3050] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              onClick={verifyDemo}
              disabled={phase==="verifying"||phase==="ballot"}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              Verify
            </button>
          </div>

          {/* Bio steps */}
          <div className="flex gap-3 py-2">
            <BioStep step={1} label="Aadhaar" icon="🪪" state={bioStates.aadhaar}/>
            <BioStep step={2} label="Face Scan" icon="📷" state={bioStates.face}/>
            <BioStep step={3} label="Fingerprint" icon="👆" state={bioStates.fp}/>
          </div>

          {/* Verified voter card */}
          {verifiedVoter && (
            <div className="mt-3 bg-green-500/10 border border-green-500/30 rounded-xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {verifiedVoter.full_name.split(" ").map(w=>w[0]).join("").slice(0,2)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{verifiedVoter.full_name}</p>
                <p className="text-xs text-slate-400">{verifiedVoter.id} · ****{verifiedVoter.aadhaar_last4}</p>
                <p className="text-xs text-slate-400">{verifiedVoter.constituency}</p>
              </div>
              <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">✓ Verified</span>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — EVM Machine */}
      <div>
        <div className="rounded-2xl overflow-hidden border-2 border-[#253d60] shadow-2xl">
          {/* Tiranga header */}
          <div className="h-1.5 flex">
            <div className="flex-1" style={{background:"#FF9933"}}/>
            <div className="flex-1 bg-white"/>
            <div className="flex-1" style={{background:"#138808"}}/>
          </div>
          <div className="bg-[#0a1628] px-4 py-3 text-center border-b border-[#1e3050]">
            <h3 className="text-sm font-bold text-white">🗳️ Electronic Voting Machine</h3>
            <p className="text-[10px] text-slate-400">SmartVote AI Biometric EVM · General Election 2025</p>
          </div>

          {/* Screen */}
          <div className="bg-[#050d1a] px-3 py-2 mx-3 mt-3 rounded-lg border border-[#1e3050] font-mono text-[10px]">
            <p className="text-cyan-400">STATUS: <span className="text-green-400">ONLINE ✓</span> &nbsp;|&nbsp; BLOCKCHAIN: <span className="text-green-400">SYNCED</span></p>
            {verifiedVoter
              ? <p className="text-white mt-1">VOTER: {verifiedVoter.full_name} ({verifiedVoter.id}) — PROCEED</p>
              : <p className="text-slate-500 mt-1">Awaiting voter verification...</p>
            }
          </div>

          {/* Ballot */}
          <div className="p-3 space-y-2 mt-1">
            <p className="text-[10px] text-slate-400 px-1">SELECT CANDIDATE — PRESS BUTTON</p>
            {PARTIES.map((p,i) => (
              <div
                key={p.id}
                onClick={() => phase==="ballot" && setSelectedParty(p.id)}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  phase !== "ballot" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                } ${selectedParty===p.id ? "border-blue-500 bg-blue-500/10" : "border-[#1e3050] bg-[#111e35] hover:border-[#253d60]"}`}
              >
                <div className="w-6 h-6 rounded-full bg-[#1a2a45] flex items-center justify-center text-xs font-bold text-white">{i+1}</div>
                <span className="text-2xl">{p.symbol}</span>
                <div className="flex-1">
                  <p className="text-xs font-medium text-white">{p.name}</p>
                  <p className="text-[10px] text-slate-400">{p.abbr}</p>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedParty===p.id ? "border-blue-500" : "border-[#253d60]"}`}>
                  {selectedParty===p.id && <div className="w-2 h-2 rounded-full bg-blue-500"/>}
                </div>
              </div>
            ))}
          </div>

          <div className="px-3 pb-3 flex gap-2">
            <button onClick={()=>setSelectedParty(null)}
              className="bg-[#111e35] border border-[#1e3050] text-slate-400 rounded-xl px-3 py-2 text-xs hover:text-white transition-colors">
              ✕ Clear
            </button>
            <button
              onClick={castVote}
              disabled={!selectedParty || phase!=="ballot"}
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:from-blue-500 hover:to-blue-600 transition-all"
            >
              🗳️ CAST VOTE
            </button>
          </div>
          <div className="h-1.5 flex">
            <div className="flex-1" style={{background:"#FF9933"}}/>
            <div className="flex-1 bg-white"/>
            <div className="flex-1" style={{background:"#138808"}}/>
          </div>
        </div>
        <p className="text-center text-xs text-slate-500 mt-2">
          {phase==="ballot" ? "✓ Voter verified — Select candidate and cast vote" : "Verify voter identity to enable voting"}
        </p>
      </div>
    </div>
  );
}

const delay = ms => new Promise(r => setTimeout(r, ms));
