"""
SmartVote backend — small-scale, real (non-demo) election backend.

Honesty note: earlier prototype UI showed a fake "Aadhaar / face / fingerprint"
scanning animation. There is no real biometric hardware wired up here, so this
backend implements voter verification as Voter ID + PIN (or optionally OTP) —
a real two-factor check, but plainly what it is.

Scale note: this is suitable for a small private election (housing society,
club, student body, company). It is NOT a certified government election
system — those have legal, auditing, and security requirements far beyond a
single FastAPI + SQLite app.

Admin auth design: admin sessions are server-side revocable (AdminSession
table) behind an httpOnly cookie, not a bare stateless JWT — so logout and
password-change actually invalidate old sessions instead of just expiring
client-side. Voter verify→cast sessions stay as short-lived stateless JWTs
since they're single-purpose and low-value (10 minutes, one voter, no admin
power).
"""
import os
import csv
import io
import random
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from .models import (
    init_db, get_db, sha256_hex, AdminUser, AdminSession, Household, Voter, VoteBlock,
    AuditLog, ElectionSettings
)
from .auth import (
    hash_password, verify_password, create_access_token, decode_access_token,
    new_session_token, new_totp_secret, totp_provisioning_uri, totp_verify,
)
from .ratelimit import rate_limit, clear_attempts
from .security import SecurityHeadersMiddleware, pin_is_weak, password_is_weak

app = FastAPI(title="SmartVote API")
app.add_middleware(SecurityHeadersMiddleware)

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COOKIE_NAME = "sv_session"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"  # set true once served over HTTPS
# "lax" works when frontend+backend share a domain (e.g. one server behind one reverse proxy).
# "none" is required when they're on different domains (e.g. frontend on Vercel, backend on
# Render/Railway) — browsers only allow SameSite=None cookies when Secure=true (HTTPS), so
# COOKIE_SECURE must also be true in that setup.
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()
SESSION_HOURS = int(os.getenv("ADMIN_SESSION_HOURS", "8"))
LOCKOUT_THRESHOLD = 5
LOCKOUT_MINUTES = 15

# In-memory store for the short-lived "passed password, awaiting 2FA code" state.
# Fine for a single-process small-scale deployment; would need a shared store
# (Redis) behind multiple workers.
_pending_2fa: dict[str, dict] = {}


@app.on_event("startup")
def on_startup():
    init_db()
    seed_if_empty()
    if COOKIE_SAMESITE == "none" and not COOKIE_SECURE:
        print("[SmartVote WARNING] COOKIE_SAMESITE=none requires COOKIE_SECURE=true (HTTPS) or browsers will reject the session cookie — admin login will silently fail.")


def seed_if_empty():
    db = next(get_db())
    try:
        if db.query(AdminUser).count() == 0:
            db.add(AdminUser(
                username="admin", full_name="Election Administrator",
                password_hash=hash_password(os.getenv("SEED_ADMIN_PASSWORD", "ChangeMe@123")),
                role="super_admin",
            ))
            db.commit()
            _audit(db, "SEED_ADMIN_CREATED", "system",
                   "Default admin created — CHANGE THIS PASSWORD before real use.")

        # Optional extra logins, purely from env vars — handy so you don't have
        # to log in and click through Settings just to provision the other
        # roles. Only created if the matching *_PASSWORD var is set and the
        # username doesn't already exist; safe to leave unset.
        _seed_optional_role(db, "SEED_VOTER_MANAGER_PASSWORD", "voter_manager", "Voter Manager", "voter_manager")
        _seed_optional_role(db, "SEED_VOTE_TRACKER_PASSWORD", "vote_tracker", "Vote Tracker", "vote_tracker")
        _seed_optional_role(db, "SEED_ELECTION_OFFICER_PASSWORD", "election_officer", "Election Officer", "election_officer")

        if db.query(ElectionSettings).count() == 0:
            db.add(ElectionSettings(id=1))
            db.commit()
    finally:
        db.close()


def _seed_optional_role(db: Session, env_var: str, default_username: str, full_name: str, role: str):
    password = os.getenv(env_var)
    if not password:
        return
    username = os.getenv(env_var.replace("_PASSWORD", "_USERNAME"), default_username)
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        return
    db.add(AdminUser(username=username, full_name=full_name, password_hash=hash_password(password), role=role))
    db.commit()
    _audit(db, "SEED_ADMIN_CREATED", "system", f"{username} ({role}) created from {env_var}")


def _audit(db: Session, action: str, actor: Optional[str], details: str = ""):
    prev = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
    prev_hash = prev.hash if prev else "0" * 64
    entry = AuditLog(action=action, actor=actor, details=details, prev_hash=prev_hash, ts=datetime.utcnow())
    entry.hash = sha256_hex(f"{action}|{actor}|{details}|{prev_hash}|{entry.ts.isoformat()}")
    db.add(entry)
    db.commit()
    return entry


# ------------------------------------------------------------ admin auth ----
def get_current_admin(request: Request, db: Session = Depends(get_db)) -> AdminUser:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not logged in")
    sess = db.query(AdminSession).filter(AdminSession.token == token).first()
    if not sess or sess.revoked or sess.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Session expired or invalid — please log in again")
    user = db.query(AdminUser).filter(AdminUser.username == sess.admin_username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.sessions_valid_after and sess.created_at < user.sessions_valid_after:
        raise HTTPException(status_code=401, detail="Session invalidated (password changed) — please log in again")
    return user


def _create_session(db: Session, user: AdminUser, response: Response):
    token = new_session_token()
    expires = datetime.utcnow() + timedelta(hours=SESSION_HOURS)
    db.add(AdminSession(token=token, admin_username=user.username, expires_at=expires))
    db.commit()
    response.set_cookie(
        COOKIE_NAME, token, httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE,
        max_age=SESSION_HOURS * 3600, path="/",
    )


def _require_role(admin: AdminUser, *roles):
    if admin.role not in roles:
        raise HTTPException(status_code=403, detail="Not permitted")


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    rate_limit(request, f"login:{body.username}", max_attempts=8, window_seconds=300)
    user = db.query(AdminUser).filter(AdminUser.username == body.username).first()

    if user and user.locked_until and user.locked_until > datetime.utcnow():
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds())
        _audit(db, "LOGIN_BLOCKED_LOCKED", body.username)
        raise HTTPException(status_code=423, detail=f"Account locked. Try again in {remaining // 60 + 1} minute(s).")

    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= LOCKOUT_THRESHOLD:
                user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_attempts = 0
                _audit(db, "ACCOUNT_LOCKED", body.username, f"{LOCKOUT_THRESHOLD} failed attempts")
            db.commit()
        _audit(db, "LOGIN_FAILED", body.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.failed_attempts = 0
    user.locked_until = None
    db.commit()
    clear_attempts(request, f"login:{body.username}")

    if user.totp_enabled:
        temp_token = secrets.token_urlsafe(24)
        _pending_2fa[temp_token] = {"username": user.username, "expires": datetime.utcnow() + timedelta(minutes=5)}
        _audit(db, "LOGIN_AWAITING_2FA", user.username)
        return {"requires_2fa": True, "temp_token": temp_token}

    _create_session(db, user, response)
    _audit(db, "LOGIN", user.username)
    return {"requires_2fa": False, "user": {"username": user.username, "full_name": user.full_name, "role": user.role}}


class Verify2faIn(BaseModel):
    temp_token: str
    code: str


@app.post("/api/auth/2fa/verify")
def verify_2fa(body: Verify2faIn, request: Request, response: Response, db: Session = Depends(get_db)):
    pending = _pending_2fa.get(body.temp_token)
    if not pending or pending["expires"] < datetime.utcnow():
        _pending_2fa.pop(body.temp_token, None)
        raise HTTPException(status_code=401, detail="2FA session expired — log in again")
    rate_limit(request, f"2fa:{pending['username']}", max_attempts=6, window_seconds=300)

    user = db.query(AdminUser).filter(AdminUser.username == pending["username"]).first()
    if not user or not totp_verify(user.totp_secret, body.code):
        _audit(db, "2FA_FAILED", pending["username"])
        raise HTTPException(status_code=401, detail="Incorrect authenticator code")

    _pending_2fa.pop(body.temp_token, None)
    clear_attempts(request, f"2fa:{pending['username']}")
    _create_session(db, user, response)
    _audit(db, "LOGIN", user.username, "via 2FA")
    return {"user": {"username": user.username, "full_name": user.full_name, "role": user.role}}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        sess = db.query(AdminSession).filter(AdminSession.token == token).first()
        if sess:
            sess.revoked = True
            db.commit()
            _audit(db, "LOGOUT", sess.admin_username)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.post("/api/auth/logout-all-sessions")
def logout_all_sessions(admin: AdminUser = Depends(get_current_admin), response: Response = None, db: Session = Depends(get_db)):
    """Invalidate every existing session for this admin (e.g. 'log out everywhere')."""
    admin.sessions_valid_after = datetime.utcnow()
    db.commit()
    if response is not None:
        response.delete_cookie(COOKIE_NAME, path="/")
    _audit(db, "LOGOUT_ALL_SESSIONS", admin.username)
    return {"ok": True}


@app.get("/api/auth/me")
def me(admin: AdminUser = Depends(get_current_admin)):
    return {"username": admin.username, "full_name": admin.full_name, "role": admin.role, "totp_enabled": admin.totp_enabled}


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if password_is_weak(body.new_password):
        raise HTTPException(status_code=400, detail="New password is too weak — use 8+ characters mixing at least two of: lowercase, uppercase, digits, symbols, and avoid common words.")
    admin.password_hash = hash_password(body.new_password)
    admin.sessions_valid_after = datetime.utcnow()  # invalidate every other session
    db.commit()
    _audit(db, "PASSWORD_CHANGED", admin.username, "all other sessions invalidated")
    return {"ok": True}


# ------------------------------------------------------------------- 2FA ----
@app.post("/api/auth/2fa/setup")
def setup_2fa(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    secret = new_totp_secret()
    admin.totp_secret = secret
    admin.totp_enabled = False  # not active until confirmed with /enable
    db.commit()
    _audit(db, "2FA_SETUP_STARTED", admin.username)
    return {"secret": secret, "provisioning_uri": totp_provisioning_uri(secret, admin.username)}


class Confirm2faIn(BaseModel):
    code: str


@app.post("/api/auth/2fa/enable")
def enable_2fa(body: Confirm2faIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    if not admin.totp_secret or not totp_verify(admin.totp_secret, body.code):
        raise HTTPException(status_code=401, detail="Incorrect code — scan/enter the secret again and retry")
    admin.totp_enabled = True
    db.commit()
    _audit(db, "2FA_ENABLED", admin.username)
    return {"ok": True}


@app.post("/api/auth/2fa/disable")
def disable_2fa(body: Confirm2faIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    if not admin.totp_enabled or not totp_verify(admin.totp_secret, body.code):
        raise HTTPException(status_code=401, detail="Incorrect code")
    admin.totp_enabled = False
    admin.totp_secret = None
    db.commit()
    _audit(db, "2FA_DISABLED", admin.username)
    return {"ok": True}


# ---------------------------------------------------------- households -----
@app.get("/api/households/")
def list_households(constituency: str = "", limit: int = 500, db: Session = Depends(get_db)):
    q = db.query(Household)
    if constituency:
        q = q.filter(Household.constituency.ilike(f"%{constituency}%"))
    rows = q.limit(limit).all()
    total = q.count()
    return {
        "total": total,
        "households": [
            {
                "id": h.id, "constituency": h.constituency, "district": h.district,
                "member_count": h.member_count, "voted_count": h.voted_count,
                "turnout_pct": h.turnout_pct, "verified": h.verified,
            } for h in rows
        ],
    }


# --------------------------------------------------------------- voters ----
def get_settings(db: Session) -> ElectionSettings:
    s = db.query(ElectionSettings).filter(ElectionSettings.id == 1).first()
    if not s:
        s = ElectionSettings(id=1)
        db.add(s)
        db.commit()
    return s


def check_voting_window(db: Session):
    s = get_settings(db)
    if not s.voting_open:
        raise HTTPException(status_code=403, detail="Voting is currently closed by the election administrator.")
    now = datetime.utcnow()
    if s.voting_start and now < s.voting_start:
        raise HTTPException(status_code=403, detail=f"Voting has not started yet (opens {s.voting_start.isoformat()} UTC).")
    if s.voting_end and now > s.voting_end:
        raise HTTPException(status_code=403, detail=f"Voting has closed (ended {s.voting_end.isoformat()} UTC).")


class VerifyIn(BaseModel):
    voter_id: str
    pin: Optional[str] = None
    otp: Optional[str] = None


@app.post("/api/votes/verify-identity")
def verify_identity(body: VerifyIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, f"verify:{body.voter_id}", max_attempts=5, window_seconds=300)
    check_voting_window(db)

    settings = get_settings(db)
    voter = db.query(Voter).filter(Voter.id == body.voter_id).first()
    if not voter:
        _audit(db, "VOTER_VERIFY_FAILED", body.voter_id, "unknown voter id")
        raise HTTPException(status_code=401, detail="Voter ID or credential incorrect")

    if voter.has_voted:
        _audit(db, "DUPLICATE_VOTE_BLOCKED", voter.id, "Blocked at verification step")
        raise HTTPException(status_code=409, detail="This Voter ID has already voted")

    if settings.verification_mode == "otp":
        if not body.otp:
            raise HTTPException(status_code=400, detail="OTP required — request one first")
        if not voter.otp_hash or not voter.otp_expires or datetime.utcnow() > voter.otp_expires:
            raise HTTPException(status_code=401, detail="OTP expired or not requested — request a new one")
        if not verify_password(body.otp, voter.otp_hash):
            voter.otp_attempts = (voter.otp_attempts or 0) + 1
            db.commit()
            _audit(db, "VOTER_VERIFY_FAILED", body.voter_id, "wrong OTP")
            raise HTTPException(status_code=401, detail="Incorrect OTP")
        voter.otp_hash = None
        voter.otp_expires = None
        db.commit()
    else:
        if not body.pin or not verify_password(body.pin, voter.pin_hash):
            _audit(db, "VOTER_VERIFY_FAILED", body.voter_id, "wrong PIN")
            raise HTTPException(status_code=401, detail="Voter ID or PIN incorrect")

    clear_attempts(request, f"verify:{body.voter_id}")
    session_token = create_access_token({"sub": f"voter:{voter.id}"}, expires_minutes=10)
    _audit(db, "VOTER_VERIFIED", voter.id)
    return {
        "voter": {"id": voter.id, "full_name": voter.full_name, "constituency": voter.constituency},
        "session_token": session_token,
    }


class RequestOtpIn(BaseModel):
    voter_id: str


@app.post("/api/votes/request-otp")
def request_otp(body: RequestOtpIn, request: Request, db: Session = Depends(get_db)):
    """
    Generates a one-time code for a voter. There's no SMS/email provider wired
    up here — the code is written to the server log so an election operator
    can read it out or relay it. Wire this into a real SMS/email API before
    using OTP mode with voters who aren't physically in front of an operator.
    """
    rate_limit(request, f"otp:{body.voter_id}", max_attempts=5, window_seconds=600)
    settings = get_settings(db)
    if settings.verification_mode != "otp":
        raise HTTPException(status_code=400, detail="OTP mode is not enabled — see Settings")
    voter = db.query(Voter).filter(Voter.id == body.voter_id).first()
    if not voter:
        raise HTTPException(status_code=404, detail="Voter not found")
    if voter.has_voted:
        raise HTTPException(status_code=409, detail="This Voter ID has already voted")

    code = f"{random.randint(0, 999999):06d}"
    voter.otp_hash = hash_password(code)
    voter.otp_expires = datetime.utcnow() + timedelta(minutes=5)
    voter.otp_attempts = 0
    db.commit()
    _audit(db, "OTP_ISSUED", voter.id)
    print(f"[SmartVote OTP] Voter {voter.id} ({voter.full_name}) code: {code} (valid 5 min)")
    return {"ok": True, "message": "OTP generated. Ask the election operator for the code (see server console)."}


class CastIn(BaseModel):
    voter_id: str
    party_id: str
    session_token: str
    station_id: Optional[str] = None


@app.post("/api/votes/cast")
def cast_vote(body: CastIn, db: Session = Depends(get_db)):
    check_voting_window(db)
    payload = decode_access_token(body.session_token)
    if not payload or payload.get("sub") != f"voter:{body.voter_id}":
        raise HTTPException(status_code=401, detail="Invalid or expired verification session")

    voter = db.query(Voter).filter(Voter.id == body.voter_id).first()
    if not voter:
        raise HTTPException(status_code=404, detail="Voter not found")
    if voter.has_voted:
        _audit(db, "DUPLICATE_VOTE_BLOCKED", voter.id, "Blocked at cast step")
        raise HTTPException(status_code=409, detail="This Voter ID has already voted")

    prev = db.query(VoteBlock).order_by(VoteBlock.idx.desc()).first()
    prev_hash = prev.hash if prev else "0" * 64
    idx = (prev.idx + 1) if prev else 0
    ts = datetime.utcnow()
    station = (body.station_id or "").strip() or None
    block = VoteBlock(
        idx=idx, timestamp=ts, voter_id=voter.id, party_id=body.party_id,
        constituency=voter.constituency, station_id=station, prev_hash=prev_hash,
    )
    block.hash = sha256_hex(f"{idx}|{voter.id}|{body.party_id}|{voter.constituency}|{station}|{prev_hash}|{ts.isoformat()}")
    db.add(block)

    voter.has_voted = True
    if voter.household_id:
        hh = db.query(Household).filter(Household.id == voter.household_id).first()
        if hh:
            hh.voted_count = min(hh.voted_count + 1, hh.member_count)

    db.commit()
    _audit(db, "VOTE_CAST", voter.id, f"party={body.party_id} station={station or '-'}")

    return {
        "receipt": {
            "voter_id": voter.id,
            "voter_name": voter.full_name,
            "party": body.party_id,
            "constituency": voter.constituency,
            "station_id": station,
            "tx_hash": "0x" + block.hash,
            "receipt_hash": block.hash[:10].upper(),
            "voted_at": ts.isoformat(),
        }
    }


@app.get("/api/votes/check-receipt")
def check_receipt(tx_hash: str, db: Session = Depends(get_db)):
    """
    Public transparency check: confirms a receipt hash exists in the chain
    without revealing which party it was cast for, preserving ballot secrecy
    while still letting a voter confirm their vote was recorded.
    """
    clean = tx_hash.replace("0x", "").strip().lower()
    block = db.query(VoteBlock).filter(VoteBlock.hash == clean).first()
    if not block:
        return {"found": False}
    return {"found": True, "index": block.idx, "timestamp": block.timestamp.isoformat(), "constituency": block.constituency}


@app.get("/api/votes/lookup")
def lookup_voter_status(voter_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Public pre-election self-check: "am I registered, have I already voted?"
    Deliberately returns nothing else (no name, no PIN, no constituency) so it
    can't be used to harvest voter details, and is rate-limited per IP against
    ID-enumeration scans.
    """
    rate_limit(request, "lookup", max_attempts=20, window_seconds=60)
    voter = db.query(Voter).filter(Voter.id == voter_id.strip()).first()
    if not voter:
        return {"registered": False, "has_voted": False}
    return {"registered": True, "has_voted": voter.has_voted}


# ------------------------------------------------------------ blockchain ---
@app.get("/api/blockchain/results")
def results(db: Session = Depends(get_db)):
    rows = db.query(VoteBlock.party_id, func.count(VoteBlock.idx)).group_by(VoteBlock.party_id).all()
    return {"results": [{"option": party_id, "votes": count} for party_id, count in rows if party_id]}


@app.get("/api/blockchain/blocks")
def blocks(db: Session = Depends(get_db)):
    rows = db.query(VoteBlock).order_by(VoteBlock.idx.desc()).all()
    return {
        "blocks": [
            {
                "index": b.idx, "timestamp": b.timestamp.isoformat(), "voter_id": b.voter_id,
                "party_id": b.party_id, "constituency": b.constituency, "station_id": b.station_id,
                "prev_hash": b.prev_hash, "hash": b.hash,
            } for b in rows
        ]
    }


@app.get("/api/blockchain/verify")
def verify_chain(db: Session = Depends(get_db)):
    rows = db.query(VoteBlock).order_by(VoteBlock.idx.asc()).all()
    problems = []
    prev_hash = "0" * 64
    for b in rows:
        expected = sha256_hex(f"{b.idx}|{b.voter_id}|{b.party_id}|{b.constituency}|{b.station_id}|{b.prev_hash}|{b.timestamp.isoformat()}")
        if expected != b.hash:
            problems.append({"index": b.idx, "issue": "hash_mismatch"})
        if b.prev_hash != prev_hash:
            problems.append({"index": b.idx, "issue": "broken_link"})
        prev_hash = b.hash
    return {"valid": len(problems) == 0, "blockCount": len(rows), "problems": problems}


# ---------------------------------------------------- admin: voter setup ---
class VoterIn(BaseModel):
    id: str
    full_name: str
    pin: str
    constituency: str
    household_id: Optional[str] = None


@app.post("/api/admin/voters")
def add_voter(body: VoterIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
    if pin_is_weak(body.pin):
        raise HTTPException(status_code=400, detail="PIN too weak — avoid repeated/sequential digits (e.g. 1111, 1234); use 4-8 digits.")
    if db.query(Voter).filter(Voter.id == body.id).first():
        raise HTTPException(status_code=400, detail="Voter ID already exists")
    voter = Voter(
        id=body.id, full_name=body.full_name, pin_hash=hash_password(body.pin),
        constituency=body.constituency, household_id=body.household_id,
    )
    db.add(voter)
    db.commit()
    _audit(db, "VOTER_ADDED", admin.username, body.id)
    return {"ok": True}


@app.post("/api/admin/voters/bulk")
def bulk_add_voters(payload: dict, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """
    Bulk-import voters from CSV text. Expected header row:
    id,full_name,pin,constituency,household_id
    (household_id column is optional)
    """
    _require_role(admin, "super_admin", "voter_manager")
    csv_text = payload.get("csv", "")
    if not csv_text.strip():
        raise HTTPException(status_code=400, detail="No CSV content provided")

    reader = csv.DictReader(io.StringIO(csv_text))
    required = {"id", "full_name", "pin", "constituency"}
    if not required.issubset(set(h.strip() for h in (reader.fieldnames or []))):
        raise HTTPException(status_code=400, detail=f"CSV header must include: {', '.join(sorted(required))}")

    added, skipped, weak, errors = 0, 0, 0, []
    for i, row in enumerate(reader, start=2):  # row 1 is header
        vid = (row.get("id") or "").strip()
        name = (row.get("full_name") or "").strip()
        pin = (row.get("pin") or "").strip()
        constituency = (row.get("constituency") or "").strip()
        household_id = (row.get("household_id") or "").strip() or None
        if not (vid and name and pin and constituency):
            errors.append(f"Row {i}: missing required field(s)")
            continue
        if pin_is_weak(pin):
            weak += 1
            errors.append(f"Row {i} ({vid}): PIN too weak, skipped")
            continue
        if db.query(Voter).filter(Voter.id == vid).first():
            skipped += 1
            continue
        db.add(Voter(id=vid, full_name=name, pin_hash=hash_password(pin), constituency=constituency, household_id=household_id))
        added += 1

    db.commit()
    _audit(db, "VOTERS_BULK_IMPORTED", admin.username, f"added={added} skipped={skipped} weak={weak} errors={len(errors)}")
    return {"added": added, "skipped_existing": skipped, "weak_pins_skipped": weak, "errors": errors}


@app.get("/api/admin/voters")
def list_voters(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
    rows = db.query(Voter).all()
    return {"voters": [
        {"id": v.id, "full_name": v.full_name, "constituency": v.constituency, "has_voted": v.has_voted}
        for v in rows
    ]}


@app.delete("/api/admin/voters/{voter_id}")
def delete_voter(voter_id: str, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
    voter = db.query(Voter).filter(Voter.id == voter_id).first()
    if not voter:
        raise HTTPException(status_code=404, detail="Voter not found")
    if voter.has_voted:
        raise HTTPException(status_code=400, detail="Cannot delete a voter who has already voted — that would break the audit trail")
    db.delete(voter)
    db.commit()
    _audit(db, "VOTER_DELETED", admin.username, voter_id)
    return {"ok": True}


class ResetPinIn(BaseModel):
    new_pin: str


@app.post("/api/admin/voters/{voter_id}/reset-pin")
def reset_voter_pin(voter_id: str, body: ResetPinIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
    if pin_is_weak(body.new_pin):
        raise HTTPException(status_code=400, detail="PIN too weak — avoid repeated/sequential digits; use 4-8 digits.")
    voter = db.query(Voter).filter(Voter.id == voter_id).first()
    if not voter:
        raise HTTPException(status_code=404, detail="Voter not found")
    voter.pin_hash = hash_password(body.new_pin)
    db.commit()
    _audit(db, "VOTER_PIN_RESET", admin.username, voter_id)
    return {"ok": True}


class HouseholdIn(BaseModel):
    id: str
    constituency: str
    district: str
    member_count: int


@app.post("/api/admin/households")
def add_household(body: HouseholdIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
    if db.query(Household).filter(Household.id == body.id).first():
        raise HTTPException(status_code=400, detail="Household ID already exists")
    db.add(Household(id=body.id, constituency=body.constituency, district=body.district,
                      member_count=body.member_count, voted_count=0, verified=True))
    db.commit()
    _audit(db, "HOUSEHOLD_ADDED", admin.username, body.id)
    return {"ok": True}


@app.post("/api/admin/households/bulk")
def bulk_add_households(payload: dict, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """CSV header required: id,constituency,district,member_count"""
    _require_role(admin, "super_admin", "voter_manager")
    csv_text = payload.get("csv", "")
    if not csv_text.strip():
        raise HTTPException(status_code=400, detail="No CSV content provided")

    reader = csv.DictReader(io.StringIO(csv_text))
    required = {"id", "constituency", "district", "member_count"}
    if not required.issubset(set(h.strip() for h in (reader.fieldnames or []))):
        raise HTTPException(status_code=400, detail=f"CSV header must include: {', '.join(sorted(required))}")

    added, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):
        hid = (row.get("id") or "").strip()
        constituency = (row.get("constituency") or "").strip()
        district = (row.get("district") or "").strip()
        member_count_raw = (row.get("member_count") or "").strip()
        if not (hid and constituency and district and member_count_raw.isdigit()):
            errors.append(f"Row {i}: missing/invalid field(s)")
            continue
        if db.query(Household).filter(Household.id == hid).first():
            skipped += 1
            continue
        db.add(Household(id=hid, constituency=constituency, district=district,
                          member_count=int(member_count_raw), voted_count=0, verified=True))
        added += 1

    db.commit()
    _audit(db, "HOUSEHOLDS_BULK_IMPORTED", admin.username, f"added={added} skipped={skipped} errors={len(errors)}")
    return {"added": added, "skipped_existing": skipped, "errors": errors}


@app.get("/api/admin/audit-log")
def audit_log(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin")
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(500).all()
    return {"entries": [
        {"id": a.id, "ts": a.ts.isoformat(), "action": a.action, "actor": a.actor,
         "details": a.details, "hash": a.hash} for a in rows
    ]}


@app.get("/api/admin/audit-log/verify")
def verify_audit_log(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin")
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).all()
    problems = []
    prev_hash = "0" * 64
    for a in rows:
        expected = sha256_hex(f"{a.action}|{a.actor}|{a.details}|{prev_hash}|{a.ts.isoformat()}")
        if expected != a.hash:
            problems.append({"id": a.id, "issue": "hash_mismatch"})
        if a.prev_hash != prev_hash:
            problems.append({"id": a.id, "issue": "broken_link"})
        prev_hash = a.hash
    return {"valid": len(problems) == 0, "entryCount": len(rows), "problems": problems}


# ------------------------------------------------------------- admin users --
VALID_ADMIN_ROLES = ("super_admin", "voter_manager", "vote_tracker", "election_officer")


class AdminUserIn(BaseModel):
    username: str
    full_name: str
    password: str
    role: str


@app.get("/api/admin/users")
def list_admin_users(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Only super_admin can see/manage other admin accounts."""
    _require_role(admin, "super_admin")
    rows = db.query(AdminUser).all()
    return {"users": [
        {"username": u.username, "full_name": u.full_name, "role": u.role, "totp_enabled": u.totp_enabled}
        for u in rows
    ]}


@app.post("/api/admin/users")
def create_admin_user(body: AdminUserIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """
    Creates another admin-panel login with a specific role — this is how you
    give someone a voter_manager / vote_tracker / election_officer account on
    the real (live) backend. The demo credentials shown anywhere in the UI
    only exist in offline/local demo mode; they are NOT real accounts here.
    """
    _require_role(admin, "super_admin")
    if body.role not in VALID_ADMIN_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of: {', '.join(VALID_ADMIN_ROLES)}")
    if password_is_weak(body.password):
        raise HTTPException(status_code=400, detail="Password too weak — 8+ characters mixing at least two of: lowercase, uppercase, digits, symbols; avoid common words.")
    if db.query(AdminUser).filter(AdminUser.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    db.add(AdminUser(
        username=body.username, full_name=body.full_name,
        password_hash=hash_password(body.password), role=body.role,
    ))
    db.commit()
    _audit(db, "ADMIN_USER_CREATED", admin.username, f"{body.username} ({body.role})")
    return {"ok": True}


@app.delete("/api/admin/users/{username}")
def delete_admin_user(username: str, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin")
    if username == admin.username:
        raise HTTPException(status_code=400, detail="You can't delete your own account while logged in as it")
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.query(AdminSession).filter(AdminSession.admin_username == username).delete()
    db.delete(user)
    db.commit()
    _audit(db, "ADMIN_USER_DELETED", admin.username, username)
    return {"ok": True}


class AdminResetPasswordIn(BaseModel):
    new_password: str


@app.post("/api/admin/users/{username}/reset-password")
def reset_admin_user_password(username: str, body: AdminResetPasswordIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Super admin resetting someone else's forgotten password."""
    _require_role(admin, "super_admin")
    if password_is_weak(body.new_password):
        raise HTTPException(status_code=400, detail="Password too weak — 8+ characters mixing at least two of: lowercase, uppercase, digits, symbols; avoid common words.")
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
    user.sessions_valid_after = datetime.utcnow()  # log that user out everywhere
    user.failed_attempts = 0
    user.locked_until = None
    db.commit()
    _audit(db, "ADMIN_PASSWORD_RESET_BY_ADMIN", admin.username, username)
    return {"ok": True}


# ------------------------------------------------------- election settings --
class SettingsIn(BaseModel):
    election_name: Optional[str] = None
    voting_open: Optional[bool] = None
    voting_start: Optional[datetime] = None
    voting_end: Optional[datetime] = None
    verification_mode: Optional[str] = None


@app.get("/api/admin/settings")
def read_settings(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    s = get_settings(db)
    return {
        "election_name": s.election_name, "voting_open": s.voting_open,
        "voting_start": s.voting_start.isoformat() if s.voting_start else None,
        "voting_end": s.voting_end.isoformat() if s.voting_end else None,
        "verification_mode": s.verification_mode,
        "finalized": s.finalized,
        "finalized_at": s.finalized_at.isoformat() if s.finalized_at else None,
        "finalized_by": s.finalized_by,
    }


@app.post("/api/admin/settings")
def update_settings(body: SettingsIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin")
    s = get_settings(db)
    if s.finalized and body.voting_open:
        raise HTTPException(status_code=400, detail="Election is finalized — voting cannot be reopened. Start a new election instead.")
    if body.election_name is not None:
        s.election_name = body.election_name
    if body.voting_open is not None:
        s.voting_open = body.voting_open
    if body.voting_start is not None:
        s.voting_start = body.voting_start
    if body.voting_end is not None:
        s.voting_end = body.voting_end
    if body.verification_mode is not None:
        if body.verification_mode not in ("pin", "otp"):
            raise HTTPException(status_code=400, detail="verification_mode must be 'pin' or 'otp'")
        s.verification_mode = body.verification_mode
    db.commit()
    _audit(db, "SETTINGS_UPDATED", admin.username)
    return {"ok": True}


class FinalizeIn(BaseModel):
    confirm: str  # must exactly equal "FINALIZE" — deliberate friction against misclicks


@app.post("/api/admin/finalize")
def finalize_election(body: FinalizeIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """
    Locks the election: closes voting permanently and marks results as
    certified. This cannot be undone through the API — it's meant to be the
    "we're done, seal it" action after polls close and results are checked.
    """
    _require_role(admin, "super_admin")
    if body.confirm != "FINALIZE":
        raise HTTPException(status_code=400, detail='Type "FINALIZE" exactly to confirm')
    s = get_settings(db)
    if s.finalized:
        raise HTTPException(status_code=400, detail="Already finalized")
    s.voting_open = False
    s.finalized = True
    s.finalized_at = datetime.utcnow()
    s.finalized_by = admin.username
    db.commit()
    _audit(db, "ELECTION_FINALIZED", admin.username)
    return {"ok": True, "finalized_at": s.finalized_at.isoformat()}


@app.get("/api/settings/public")
def public_settings(db: Session = Depends(get_db)):
    """Non-admin info the voting UI needs: election name, whether polls are open, verification mode."""
    s = get_settings(db)
    return {
        "election_name": s.election_name,
        "voting_open": s.voting_open,
        "voting_start": s.voting_start.isoformat() if s.voting_start else None,
        "voting_end": s.voting_end.isoformat() if s.voting_end else None,
        "verification_mode": s.verification_mode,
        "finalized": s.finalized,
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}
