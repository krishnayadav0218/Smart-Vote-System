import os
import secrets
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
import pyotp

# IMPORTANT for real/live use: set a strong, random SECRET_KEY via environment
# variable before deploying. The fallback below is only for local testing.
SECRET_KEY = os.getenv("SECRET_KEY", "CHANGE-ME-INSECURE-DEV-KEY-" + os.urandom(8).hex())
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(data: dict, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    """Used only for short-lived voter verification sessions (verify -> cast). Admin
    sessions use the revocable server-side AdminSession model instead — see main.py."""
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=expires_minutes)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, username: str, issuer: str = "SmartVote") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)


def totp_verify(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)

