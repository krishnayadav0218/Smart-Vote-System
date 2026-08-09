# SmartVote — small-scale electronic voting system

## What this actually is (read this first)
This is suitable for a **small, private election** — a housing society, club,
student union, cooperative, or company internal vote. It is **not** a
certified government election system. Real public elections have legal,
security, and auditing requirements (independent certification, paper
trails, statutory oversight, etc.) that a single FastAPI + React app does
not meet. Don't use this for a legally binding public election.

Two honesty fixes from the original prototype:
- The EVM screen used to show a fake "Aadhaar / face-scan / fingerprint"
  animation. There's no biometric hardware wired up, so voter verification
  is a real **Voter ID + PIN** check, shown as exactly that.
- The demo hash chain is a simple SHA-256 linked log to make tampering
  detectable, not a real blockchain/consensus network — don't oversell it
  as one when explaining the system to your voters.

## Two ways to run it

### 1. Fully offline (for trying it out / a tiny test)
No backend needed. All data is stored in the browser via localStorage.
```
npm install
npm run dev
```
Login with any demo user shown on the login screen. Good for demoing the UI,
**not** for a real vote with more than one device, since each browser has its
own separate local data.

### 2. Real backend (for actually running an election)
This is what you want once more than one person / one device is voting.

```bash
cp .env.example .env
# edit .env: set SECRET_KEY and SEED_ADMIN_PASSWORD
docker compose up --build
```
- Frontend: http://localhost
- Backend:  http://localhost:8000

First login uses username `admin` and the `SEED_ADMIN_PASSWORD` you set.
**Immediately go to Settings → Change admin password.**

Then, before voting opens:
1. Settings → Add voter for every real voter (Voter ID + name + PIN + constituency/ward).
2. Settings → confirm "Voting status" is Open.
3. Give each voter their Voter ID + PIN privately (don't post them together in a group chat).

During voting, use the EVM Machine page on whatever device(s) you're running
polling from — each entered Voter ID can only vote once; a second attempt is
blocked and logged (Fraud Detection page).

After voting, use Reports to export CSVs, and Blockchain Logs → Verify Chain
to confirm nothing in the vote log was altered.

## Multi-language
Use the 🌐 button on the login screen or in Settings to switch English / हिन्दी.
The dictionary lives in `src/context/LangContext.jsx` — add more keys/languages there.

## Scaling up later
When you outgrow this:
- Swap SQLite for Postgres (`DATABASE_URL=postgresql://...` — models already use SQLAlchemy).
- Put the backend behind HTTPS (nginx/Caddy + Let's Encrypt) — never run a real
  election over plain HTTP.
- Add per-voter one-time-link or OTP delivery (SMS/email) instead of pre-shared PINs.
- Move JWT secret + admin password into a real secrets manager.
- Add real database backups before/after the vote.

## Security notes for the small scale you're at now
- Change `SECRET_KEY` and the seed admin password before going live — the
  defaults are for local testing only.
- Run behind HTTPS if voters connect over the internet rather than a local network.
- The audit log (Audit Log page, or `/api/admin/audit-log`, super_admin only) records logins,
  voter verification, and every duplicate-vote attempt — check it after voting closes.

## What's new in this round of improvements
- **Rate limiting** on admin login and voter verify-identity (5 attempts / 5 min per IP) — blunts brute-force PIN/password guessing.
- **Voting window controls** — Settings → set an open/close toggle and optional start/end datetime; the backend enforces it on both verify and cast.
- **Bulk voter import** — Settings → paste or upload a CSV (`id,full_name,pin,constituency`) instead of adding voters one by one.
- **OTP verification mode** — Settings → switch from PIN to one-time-code. There's no SMS/email provider wired up; the code is printed to the backend server console for an operator to relay. Wire in Twilio/SMTP before using this with remote voters.
- **Audit Log page** (super_admin only, in the sidebar) — every login, verification, vote, duplicate-block, and settings change, hash-linked, with CSV export.
- **Backend test suite** — `backend/tests/test_api.py` (pytest) covering login, rate-limiting, voter/vote flow, duplicate-vote blocking, chain integrity, bulk import, and voting-window enforcement.
- **DB backup script** — `backend/scripts/backup.sh`, cron-friendly.

Run backend tests:
```bash
cd backend
pip install -r requirements-dev.txt
SECRET_KEY=test SEED_ADMIN_PASSWORD=TestAdmin@123 pytest -q
```

## HTTPS (do this before real voters connect over the internet)
Simplest option — put [Caddy](https://caddyserver.com/) in front of both services:
```
your-domain.com {
    reverse_proxy /api/* backend:8000
    reverse_proxy frontend:80
}
```
Caddy handles Let's Encrypt certificates automatically. If voting only happens
over a local network you control (e.g. one room, one Wi-Fi), plain HTTP is a
smaller risk, but HTTPS is still recommended.

## Backups
```bash
docker compose exec backend /app/scripts/backup.sh
```
Wire this into a host cron job (see comments in the script) so you have a
restore point before and after the vote.
