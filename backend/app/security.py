import re
from starlette.middleware.base import BaseHTTPMiddleware

COMMON_WEAK_PINS = {
    "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
    "1234", "4321", "0123", "1212", "2580", "123456", "654321", "111111", "000000",
}


def pin_is_weak(pin: str) -> bool:
    if not pin.isdigit():
        return True
    if len(pin) < 4 or len(pin) > 8:
        return True
    if pin in COMMON_WEAK_PINS:
        return True
    if len(set(pin)) == 1:  # all same digit, e.g. 7777
        return True
    digits = [int(c) for c in pin]
    if all(b - a == 1 for a, b in zip(digits, digits[1:])):  # ascending run, e.g. 2345
        return True
    if all(a - b == 1 for a, b in zip(digits, digits[1:])):  # descending run, e.g. 5432
        return True
    return False


def password_is_weak(password: str) -> bool:
    if len(password) < 8:
        return True
    lowered = password.lower()
    for weak in ("password", "changeme", "admin123", "12345678", "qwerty"):
        if weak in lowered:
            return True
    # require at least 2 of: lowercase, uppercase, digit, symbol
    classes = sum([
        bool(re.search(r"[a-z]", password)),
        bool(re.search(r"[A-Z]", password)),
        bool(re.search(r"\d", password)),
        bool(re.search(r"[^a-zA-Z0-9]", password)),
    ])
    return classes < 2


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds baseline hardening headers to every response."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Only meaningful once served over HTTPS — harmless over HTTP.
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response
