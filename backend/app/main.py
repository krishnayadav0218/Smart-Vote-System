"""
SmartVote backend — small-scale, real (non-demo) election backend.

Honesty note: earlier prototype UI showed a fake "Aadhaar / face / fingerprint"
scanning animation. There is no real biometric hardware wired up here, so this
backend implements verification as Voter ID + PIN (or optionally OTP) — a real
two-factor check, but plainly what it is. Do not re-label this as biometric or
government Aadhaar verification; that would misinform real voters about how
they're being authenticated.

Scale note: this is suitable for a small private election (housing society,
club, student body, company). It is NOT a certified government election
system — those have legal, auditing, and security requirements far beyond a
single FastAPI + SQLite app.
"""
import os
import csv
import io
import random
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from .models import (
    init_db, get_db, sha256_hex, AdminUser, Household, Voter, VoteBlock, AuditLog, ElectionSettings
)
from .auth import hash_password, verify_password, create_access_token, decode_access_token
from .ratelimit import rate_limit, clear_attempts

app = FastAPI(title="SmartVote API")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


@app.on_event("startup")
def on_startup():
    init_db()
    seed_if_empty()


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
        if db.query(ElectionSettings).count() == 0:
            db.add(ElectionSettings(id=1))
            db.commit()
    finally:
        db.close()


def _audit(db: Session, action: str, actor: Optional[str], details: str = ""):
    prev = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
    prev_hash = prev.hash if prev else "0" * 64
    entry = AuditLog(action=action, actor=actor, details=details, prev_hash=prev_hash, ts=datetime.utcnow())
    entry.hash = sha256_hex(f"{action}|{actor}|{details}|{prev_hash}|{entry.ts.isoformat()}")
    db.add(entry)
    db.commit()
    return entry


def get_current_admin(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> AdminUser:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = db.query(AdminUser).filter(AdminUser.username == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


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


# ---------------------------------------------------------------- auth -----
@app.post("/api/auth/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    rate_limit(request, f"login:{form.username}", max_attempts=5, window_seconds=300)
    user = db.query(AdminUser).filter(AdminUser.username == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        _audit(db, "LOGIN_FAILED", form.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    clear_attempts(request, f"login:{form.username}")
    token = create_access_token({"sub": user.username})
    _audit(db, "LOGIN", user.username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"username": user.username, "full_name": user.full_name, "role": user.role},
    }


@app.get("/api/auth/me")
def me(admin: AdminUser = Depends(get_current_admin)):
    return {"username": admin.username, "full_name": admin.full_name, "role": admin.role}


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    admin.password_hash = hash_password(body.new_password)
    db.commit()
    _audit(db, "PASSWORD_CHANGED", admin.username)
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
    can read it out or relay it. Wire this into a real SMS/email API (e.g.
    Twilio, an SMTP relay) before using OTP mode with voters who aren't
    physically in front of an operator.
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

    # No SMS/email provider configured — surfaced via server log for the operator.
    print(f"[SmartVote OTP] Voter {voter.id} ({voter.full_name}) code: {code} (valid 5 min)")

    return {"ok": True, "message": "OTP generated. Ask the election operator for the code (see server console)."}


class CastIn(BaseModel):
    voter_id: str
    party_id: str
    session_token: str


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
    block = VoteBlock(
        idx=idx, timestamp=ts, voter_id=voter.id, party_id=body.party_id,
        constituency=voter.constituency, prev_hash=prev_hash,
    )
    block.hash = sha256_hex(f"{idx}|{voter.id}|{body.party_id}|{voter.constituency}|{prev_hash}|{ts.isoformat()}")
    db.add(block)

    voter.has_voted = True
    if voter.household_id:
        hh = db.query(Household).filter(Household.id == voter.household_id).first()
        if hh:
            hh.voted_count = min(hh.voted_count + 1, hh.member_count)

    db.commit()
    _audit(db, "VOTE_CAST", voter.id, f"party={body.party_id}")

    return {
        "receipt": {
            "voter_id": voter.id,
            "voter_name": voter.full_name,
            "party": body.party_id,
            "constituency": voter.constituency,
            "tx_hash": "0x" + block.hash,
            "receipt_hash": block.hash[:10].upper(),
            "voted_at": ts.isoformat(),
        }
    }


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
                "party_id": b.party_id, "constituency": b.constituency,
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
        expected = sha256_hex(f"{b.idx}|{b.voter_id}|{b.party_id}|{b.constituency}|{b.prev_hash}|{b.timestamp.isoformat()}")
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


def _require_role(admin: AdminUser, *roles):
    if admin.role not in roles:
        raise HTTPException(status_code=403, detail="Not permitted")


@app.post("/api/admin/voters")
def add_voter(body: VoterIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
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

    added, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):  # row 1 is header
        vid = (row.get("id") or "").strip()
        name = (row.get("full_name") or "").strip()
        pin = (row.get("pin") or "").strip()
        constituency = (row.get("constituency") or "").strip()
        household_id = (row.get("household_id") or "").strip() or None
        if not (vid and name and pin and constituency):
            errors.append(f"Row {i}: missing required field(s)")
            continue
        if db.query(Voter).filter(Voter.id == vid).first():
            skipped += 1
            continue
        db.add(Voter(id=vid, full_name=name, pin_hash=hash_password(pin), constituency=constituency, household_id=household_id))
        added += 1

    db.commit()
    _audit(db, "VOTERS_BULK_IMPORTED", admin.username, f"added={added} skipped={skipped} errors={len(errors)}")
    return {"added": added, "skipped_existing": skipped, "errors": errors}


@app.get("/api/admin/voters")
def list_voters(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin", "voter_manager")
    rows = db.query(Voter).all()
    return {"voters": [
        {"id": v.id, "full_name": v.full_name, "constituency": v.constituency, "has_voted": v.has_voted}
        for v in rows
    ]}


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


@app.get("/api/admin/audit-log")
def audit_log(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin")
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(500).all()
    return {"entries": [
        {"id": a.id, "ts": a.ts.isoformat(), "action": a.action, "actor": a.actor,
         "details": a.details, "hash": a.hash} for a in rows
    ]}


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
    }


@app.post("/api/admin/settings")
def update_settings(body: SettingsIn, admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    _require_role(admin, "super_admin")
    s = get_settings(db)
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
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}
