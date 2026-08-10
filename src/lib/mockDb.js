// src/lib/mockDb.js
//
// A localStorage-backed "mock backend" so the whole demo runs standalone
// (no FastAPI / Hardhat node required). Every page falls back to this when
// the real API isn't reachable. Nothing here is cryptographically secure —
// the hash function is a simple, synchronous demo hash (not SHA-256) purely
// to illustrate the "each block links to the previous one" concept. Do not
// present this chain as tamper-proof in a real deployment.

const LS_KEY = "smartvote_db_v2";

export const PARTIES = [
  { id: "a", name: "Candidate / Option A", abbr: "OPT-A", symbol: "🔵", color: "#3b82f6" },
  { id: "b", name: "Candidate / Option B", abbr: "OPT-B", symbol: "🟠", color: "#f59e0b" },
  { id: "c", name: "Candidate / Option C", abbr: "OPT-C", symbol: "🟢", color: "#22c55e" },
  { id: "d", name: "Candidate / Option D", abbr: "OPT-D", symbol: "🟣", color: "#a855f7" },
];

export const CONSTITUENCIES = ["Constituency 1", "Constituency 2", "Constituency 3", "Constituency 4"];
const DISTRICTS = ["North District", "South District", "East District", "West District"];

// ---- simple deterministic demo hash (NOT cryptographic) --------------------
export function demoHash(input) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = (Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)) >>> 0;
  h2 = (Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)) >>> 0;
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function seed() {
  const rand = seededRandom(42);
  const households = [];
  let hid = 1;
  for (const c of CONSTITUENCIES) {
    for (let i = 0; i < 10; i++) {
      const members = 2 + Math.floor(rand() * 6);
      const voted = Math.floor(rand() * (members + 1));
      households.push({
        id: `HH-${String(hid).padStart(4, "0")}`,
        constituency: c,
        district: DISTRICTS[hid % DISTRICTS.length],
        member_count: members,
        voted_count: voted,
        turnout_pct: members ? Math.round((voted / members) * 1000) / 10 : 0,
        verified: rand() > 0.15,
      });
      hid++;
    }
  }
  // introduce a couple of intentional anomalies for the fraud-detection demo
  households[3].voted_count = households[3].member_count + 2;
  households[3].turnout_pct = Math.round((households[3].voted_count / households[3].member_count) * 1000) / 10;
  households[17].verified = false;
  households[17].voted_count = households[17].member_count;
  households[17].turnout_pct = 100;

  const genesis = {
    index: 0,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    voter_id: null,
    party_id: null,
    constituency: null,
    prev_hash: "0".repeat(16),
  };
  genesis.hash = demoHash(JSON.stringify(genesis));

  return {
    households,
    blocks: [genesis],
    votedVoterIds: {},
    fraudAlerts: [],
    auditLog: [],
    settings: {
      electionName: "General Election 2025 (Demo)",
      constituencies: CONSTITUENCIES,
      parties: PARTIES,
      votingOpen: true,
    },
    users: [
      { username: "krishna", password: "Krishna@2025!", role: "super_admin", full_name: "Krishna Admin" },
      { username: "voter_manager", password: "VoterMgr@2025", role: "voter_manager", full_name: "Voter Manager" },
      { username: "vote_tracker", password: "Tracker@2025", role: "vote_tracker", full_name: "Vote Tracker" },
      { username: "officer", password: "Officer@2025", role: "election_officer", full_name: "Election Officer" },
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through to reseed */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

let DB = load();

function persist() {
  save(DB);
}

export function resetDemoData() {
  DB = seed();
  persist();
  return DB;
}

// ---- audit log ---------------------------------------------------------
export function addAuditEntry(action, actor, details = "") {
  const prev = DB.auditLog[DB.auditLog.length - 1];
  const entry = {
    id: DB.auditLog.length + 1,
    ts: new Date().toISOString(),
    action,
    actor,
    details,
    prev_hash: prev ? prev.hash : "0".repeat(16),
  };
  entry.hash = demoHash(JSON.stringify(entry));
  DB.auditLog.push(entry);
  persist();
  return entry;
}

export function getAuditLog() {
  return [...DB.auditLog].reverse();
}

// ---- households ---------------------------------------------------------
export function listHouseholds({ constituency = "", limit = 1000 } = {}) {
  let rows = DB.households;
  if (constituency) {
    rows = rows.filter((h) => h.constituency.toLowerCase().includes(constituency.toLowerCase()));
  }
  return { households: rows.slice(0, limit), total: rows.length };
}

export function householdStats() {
  const totalMembers = DB.households.reduce((s, h) => s + h.member_count, 0);
  const totalVoted = DB.households.reduce((s, h) => s + h.voted_count, 0);
  return {
    households: DB.households.length,
    members: totalMembers,
    voted: totalVoted,
    turnout: totalMembers ? Math.round((totalVoted / totalMembers) * 1000) / 10 : 0,
    byConstituency: CONSTITUENCIES.map((c) => {
      const rows = DB.households.filter((h) => h.constituency === c);
      const members = rows.reduce((s, h) => s + h.member_count, 0);
      const voted = rows.reduce((s, h) => s + h.voted_count, 0);
      return { constituency: c, members, voted, turnout: members ? Math.round((voted / members) * 1000) / 10 : 0 };
    }),
  };
}

// ---- voting / blockchain --------------------------------------------------
export function isVoterUsed(voterId) {
  return Boolean(DB.votedVoterIds[voterId]);
}

export function castVote({ voterId, partyId, constituency }) {
  if (!DB.settings.votingOpen) {
    throw new Error("Voting is currently closed by the election administrator.");
  }
  if (isVoterUsed(voterId)) {
    addAuditEntry("DUPLICATE_VOTE_BLOCKED", voterId, `Attempted second vote for ${voterId}`);
    logFraudAlert({
      severity: "critical",
      type: "duplicate_vote_attempt",
      message: `Blocked a second vote attempt for voter ${voterId}.`,
    });
    throw new Error("This Voter ID has already cast a vote. Duplicate vote blocked.");
  }
  const prev = DB.blocks[DB.blocks.length - 1];
  const block = {
    index: DB.blocks.length,
    timestamp: new Date().toISOString(),
    voter_id: voterId,
    party_id: partyId,
    constituency: constituency || null,
    prev_hash: prev.hash,
  };
  block.hash = demoHash(JSON.stringify(block));
  DB.blocks.push(block);
  DB.votedVoterIds[voterId] = block.hash;
  persist();
  return block;
}

export function getResults() {
  const counts = {};
  for (const p of PARTIES) counts[p.id] = 0;
  for (const b of DB.blocks) {
    if (b.party_id && counts[b.party_id] !== undefined) counts[b.party_id]++;
  }
  return PARTIES.map((p) => ({ option: p.name, party_id: p.id, symbol: p.symbol, color: p.color, votes: counts[p.id] }));
}

export function getBlocks() {
  return [...DB.blocks].reverse();
}

// Recomputes every block's hash from its own contents and checks the prev_hash
// pointer against its predecessor — flags exactly where a chain would break.
export function verifyChain() {
  const blocks = DB.blocks;
  const problems = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const { hash, ...rest } = b;
    const recomputed = demoHash(JSON.stringify(rest));
    if (recomputed !== hash) problems.push({ index: b.index, issue: "hash_mismatch" });
    if (i > 0 && b.prev_hash !== blocks[i - 1].hash) problems.push({ index: b.index, issue: "broken_link" });
  }
  return { valid: problems.length === 0, blockCount: blocks.length, problems };
}

// ---- fraud detection ------------------------------------------------------
export function logFraudAlert({ severity, type, message }) {
  const alert = {
    id: DB.fraudAlerts.length + 1,
    ts: new Date().toISOString(),
    severity,
    type,
    message,
    reviewed: false,
  };
  DB.fraudAlerts.unshift(alert);
  persist();
  return alert;
}

export function markAlertReviewed(id) {
  const a = DB.fraudAlerts.find((x) => x.id === id);
  if (a) a.reviewed = true;
  persist();
}

export function getFraudAlerts() {
  return DB.fraudAlerts;
}

// Rule-based scan over household + blockchain data. Deliberately simple,
// explainable rules (no opaque scoring) so every flag can be manually checked.
export function runFraudScan() {
  const newAlerts = [];
  for (const h of DB.households) {
    if (h.voted_count > h.member_count) {
      newAlerts.push({
        severity: "critical",
        type: "impossible_turnout",
        message: `${h.id} (${h.constituency}): ${h.voted_count} votes recorded for only ${h.member_count} members.`,
      });
    } else if (h.turnout_pct >= 100 && !h.verified) {
      newAlerts.push({
        severity: "high",
        type: "unverified_full_turnout",
        message: `${h.id} (${h.constituency}): 100% turnout but household is not verified.`,
      });
    } else if (h.turnout_pct >= 95) {
      newAlerts.push({
        severity: "medium",
        type: "high_turnout_review",
        message: `${h.id} (${h.constituency}): unusually high turnout (${h.turnout_pct}%) — recommend spot check.`,
      });
    }
  }
  // duplicate-vote blocks already logged via castVote / audit log
  const dupBlocks = DB.auditLog.filter((a) => a.action === "DUPLICATE_VOTE_BLOCKED");
  for (const d of dupBlocks) {
    newAlerts.push({ severity: "critical", type: "duplicate_vote_attempt", message: d.details });
  }

  const existingMsgs = new Set(DB.fraudAlerts.map((a) => a.message));
  let added = 0;
  for (const a of newAlerts) {
    if (!existingMsgs.has(a.message)) {
      logFraudAlert(a);
      existingMsgs.add(a.message);
      added++;
    }
  }
  return { scanned: DB.households.length, newAlertsFound: added, totalAlerts: DB.fraudAlerts.length };
}

// ---- settings ---------------------------------------------------------
export function getSettings() {
  return DB.settings;
}

export function updateSettings(patch) {
  DB.settings = { ...DB.settings, ...patch };
  persist();
  return DB.settings;
}

// ---- auth (offline fallback) --------------------------------------------
export function findUser(username, password) {
  return DB.users.find((u) => u.username === username && u.password === password) || null;
}

export function getDb() {
  return DB;
}
