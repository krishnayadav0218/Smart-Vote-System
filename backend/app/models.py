import os
import hashlib
import json
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Boolean, DateTime, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DB_URL = os.getenv("DATABASE_URL", "sqlite:///./smartvote.db")
engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class AdminUser(Base):
    __tablename__ = "admin_users"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # super_admin | voter_manager | vote_tracker | election_officer


class Household(Base):
    __tablename__ = "households"
    id = Column(String, primary_key=True)  # e.g. HH-0001
    constituency = Column(String, nullable=False)
    district = Column(String, nullable=False)
    member_count = Column(Integer, default=0)
    voted_count = Column(Integer, default=0)
    verified = Column(Boolean, default=False)

    @property
    def turnout_pct(self):
        return round((self.voted_count / self.member_count) * 1000) / 10 if self.member_count else 0.0


class Voter(Base):
    __tablename__ = "voters"
    id = Column(String, primary_key=True)  # Voter ID, admin-provisioned
    full_name = Column(String, nullable=False)
    pin_hash = Column(String, nullable=False)  # 4-6 digit PIN, hashed — NOT a real biometric/Aadhaar check
    constituency = Column(String, nullable=False)
    household_id = Column(String, ForeignKey("households.id"), nullable=True)
    has_voted = Column(Boolean, default=False)
    otp_hash = Column(String, nullable=True)
    otp_expires = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0)


class ElectionSettings(Base):
    __tablename__ = "election_settings"
    id = Column(Integer, primary_key=True, default=1)
    election_name = Column(String, default="General Election (Live)")
    voting_open = Column(Boolean, default=True)
    voting_start = Column(DateTime, nullable=True)  # null = no restriction
    voting_end = Column(DateTime, nullable=True)
    verification_mode = Column(String, default="pin")  # "pin" or "otp"


class VoteBlock(Base):
    __tablename__ = "vote_blocks"
    idx = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    voter_id = Column(String, nullable=True)  # kept for admin duplicate-vote auditing; ballot choice below is anonymous-in-spirit for a small demo, not cryptographically anonymized
    party_id = Column(String, nullable=True)
    constituency = Column(String, nullable=True)
    prev_hash = Column(String, nullable=False)
    hash = Column(String, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(Integer, primary_key=True)
    ts = Column(DateTime, default=datetime.utcnow)
    action = Column(String, nullable=False)
    actor = Column(String, nullable=True)
    details = Column(String, nullable=True)
    prev_hash = Column(String, nullable=False)
    hash = Column(String, nullable=False)


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
