"""
Basic smoke tests for the SmartVote backend.

Run with:
    cd backend
    pip install -r requirements-dev.txt
    SECRET_KEY=test SEED_ADMIN_PASSWORD=TestAdmin@123 pytest -q
"""
import os
import sys
import importlib

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("SEED_ADMIN_PASSWORD", "TestAdmin@123")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")

    for mod in ["app.models", "app.ratelimit", "app.main"]:
        if mod in sys.modules:
            del sys.modules[mod]
    main = importlib.import_module("app.main")
    with TestClient(main.app) as c:
        yield c


def login(client, username="admin", password="TestAdmin@123"):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200
    return r


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_security_headers_present(client):
    r = client.get("/api/health")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_login_lockout_after_repeated_failures(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    r = client.post("/api/auth/login", json={"username": "admin", "password": "TestAdmin@123"})
    # 5th bad attempt trips the account lock, so even the *correct* password is now rejected
    assert r.status_code == 423


def test_login_sets_cookie_and_me_works(client):
    login(client)
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_logout_revokes_session(client):
    login(client)
    assert client.get("/api/auth/me").status_code == 200
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_add_voter_rejects_weak_pin(client):
    login(client)
    r = client.post("/api/admin/voters", json={"id": "VX", "full_name": "Weak", "pin": "1234", "constituency": "Ward 1"})
    assert r.status_code == 400


def test_add_voter_and_vote_flow(client):
    login(client)
    r = client.post("/api/admin/voters", json={"id": "V1", "full_name": "Alice", "pin": "4826", "constituency": "Ward 1"})
    assert r.status_code == 200

    r = client.post("/api/votes/verify-identity", json={"voter_id": "V1", "pin": "4826"})
    assert r.status_code == 200
    session_token = r.json()["session_token"]

    r = client.post("/api/votes/cast", json={"voter_id": "V1", "party_id": "a", "session_token": session_token})
    assert r.status_code == 200
    receipt = r.json()["receipt"]
    assert receipt["voter_id"] == "V1"

    # duplicate vote must be blocked
    r = client.post("/api/votes/verify-identity", json={"voter_id": "V1", "pin": "4826"})
    assert r.status_code == 409

    # public receipt check confirms it's in the chain without needing auth
    r = client.get("/api/votes/check-receipt", params={"tx_hash": receipt["tx_hash"]})
    assert r.status_code == 200
    assert r.json()["found"] is True


def test_chain_verifies(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "V2", "full_name": "Bob", "pin": "7351", "constituency": "Ward 1"})
    v = client.post("/api/votes/verify-identity", json={"voter_id": "V2", "pin": "7351"}).json()
    client.post("/api/votes/cast", json={"voter_id": "V2", "party_id": "b", "session_token": v["session_token"]})

    r = client.get("/api/blockchain/verify")
    assert r.status_code == 200
    assert r.json()["valid"] is True


def test_audit_log_chain_verifies(client):
    login(client)
    r = client.get("/api/admin/audit-log/verify")
    assert r.status_code == 200
    assert r.json()["valid"] is True


def test_bulk_voter_import_rejects_weak_pins(client):
    login(client)
    csv_text = "id,full_name,pin,constituency\nV10,Carl,4826,Ward 2\nV11,Dana,1111,Ward 2\n"
    r = client.post("/api/admin/voters/bulk", json={"csv": csv_text})
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 1
    assert body["weak_pins_skipped"] == 1


def test_voting_closed_blocks_cast(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "V3", "full_name": "Eve", "pin": "9082", "constituency": "Ward 1"})
    v = client.post("/api/votes/verify-identity", json={"voter_id": "V3", "pin": "9082"}).json()

    client.post("/api/admin/settings", json={"voting_open": False})
    r = client.post("/api/votes/cast", json={"voter_id": "V3", "party_id": "a", "session_token": v["session_token"]})
    assert r.status_code == 403


def test_change_password_invalidates_other_sessions(client):
    login(client)
    r = client.post("/api/auth/change-password", json={"current_password": "TestAdmin@123", "new_password": "N3wStrongPass!"})
    assert r.status_code == 200
    # old cookie's session predates the password change -> should now be rejected
    assert client.get("/api/auth/me").status_code == 401
    # new password + fresh login works
    login(client, password="N3wStrongPass!")
    assert client.get("/api/auth/me").status_code == 200


def test_weak_new_password_rejected(client):
    login(client)
    r = client.post("/api/auth/change-password", json={"current_password": "TestAdmin@123", "new_password": "password"})
    assert r.status_code == 400


def test_delete_voter_who_has_not_voted(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "V5", "full_name": "Frank", "pin": "6194", "constituency": "Ward 1"})
    r = client.delete("/api/admin/voters/V5")
    assert r.status_code == 200


def test_delete_voter_who_has_voted_is_blocked(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "V6", "full_name": "Gita", "pin": "3057", "constituency": "Ward 1"})
    v = client.post("/api/votes/verify-identity", json={"voter_id": "V6", "pin": "3057"}).json()
    client.post("/api/votes/cast", json={"voter_id": "V6", "party_id": "a", "session_token": v["session_token"]})
    r = client.delete("/api/admin/voters/V6")
    assert r.status_code == 400


def test_2fa_setup_and_login_flow(client):
    login(client)
    setup = client.post("/api/auth/2fa/setup").json()
    secret = setup["secret"]

    import pyotp
    code = pyotp.TOTP(secret).now()
    r = client.post("/api/auth/2fa/enable", json={"code": code})
    assert r.status_code == 200

    # logout, then login again should now require 2FA
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"username": "admin", "password": "TestAdmin@123"})
    assert r.status_code == 200
    body = r.json()
    assert body["requires_2fa"] is True

    code2 = pyotp.TOTP(secret).now()
    r = client.post("/api/auth/2fa/verify", json={"temp_token": body["temp_token"], "code": code2})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_public_voter_lookup_reveals_nothing_extra(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "VLOOK", "full_name": "Look Voter", "pin": "4826", "constituency": "Ward 1"})

    r = client.get("/api/votes/lookup", params={"voter_id": "VLOOK"})
    assert r.status_code == 200
    body = r.json()
    assert body == {"registered": True, "has_voted": False}
    assert "full_name" not in body and "constituency" not in body

    r = client.get("/api/votes/lookup", params={"voter_id": "NOBODY"})
    assert r.json() == {"registered": False, "has_voted": False}


def test_household_bulk_import(client):
    login(client)
    csv_text = "id,constituency,district,member_count\nHH-A,Ward 1,North,5\nHH-B,Ward 2,South,3\n"
    r = client.post("/api/admin/households/bulk", json={"csv": csv_text})
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2

    r = client.get("/api/households/")
    assert r.status_code == 200
    assert r.json()["total"] == 2


def test_station_id_recorded_and_chain_still_verifies(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "VSTN", "full_name": "Station Voter", "pin": "5271", "constituency": "Ward 1"})
    v = client.post("/api/votes/verify-identity", json={"voter_id": "VSTN", "pin": "5271"}).json()
    r = client.post("/api/votes/cast", json={"voter_id": "VSTN", "party_id": "a", "session_token": v["session_token"], "station_id": "BOOTH-2"})
    assert r.status_code == 200
    assert r.json()["receipt"]["station_id"] == "BOOTH-2"

    blocks = client.get("/api/blockchain/blocks").json()["blocks"]
    assert blocks[0]["station_id"] == "BOOTH-2"

    r = client.get("/api/blockchain/verify")
    assert r.json()["valid"] is True


def test_finalize_election_locks_voting(client):
    login(client)
    client.post("/api/admin/voters", json={"id": "VFIN", "full_name": "Fin Voter", "pin": "8302", "constituency": "Ward 1"})
    v = client.post("/api/votes/verify-identity", json={"voter_id": "VFIN", "pin": "8302"}).json()

    # wrong confirm text rejected
    r = client.post("/api/admin/finalize", json={"confirm": "yes please"})
    assert r.status_code == 400

    r = client.post("/api/admin/finalize", json={"confirm": "FINALIZE"})
    assert r.status_code == 200

    # voting is now closed even though a valid verification session exists
    r = client.post("/api/votes/cast", json={"voter_id": "VFIN", "party_id": "a", "session_token": v["session_token"]})
    assert r.status_code == 403

    # can't reopen voting once finalized
    r = client.post("/api/admin/settings", json={"voting_open": True})
    assert r.status_code == 400

    # double finalize rejected
    r = client.post("/api/admin/finalize", json={"confirm": "FINALIZE"})
    assert r.status_code == 400
