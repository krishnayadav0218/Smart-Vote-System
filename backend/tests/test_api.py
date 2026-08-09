"""
Basic smoke tests for the SmartVote backend.

Run with:
    cd backend
    SECRET_KEY=test SEED_ADMIN_PASSWORD=TestAdmin@123 pytest -q
"""
import os
import sys
import importlib

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("SEED_ADMIN_PASSWORD", "TestAdmin@123")
os.environ["DATABASE_URL"] = "sqlite:///./test_smartvote.db"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")

    # Reimport modules fresh so they pick up the per-test DB file
    for mod in ["app.models", "app.ratelimit", "app.main"]:
        if mod in sys.modules:
            del sys.modules[mod]
    main = importlib.import_module("app.main")
    with TestClient(main.app) as c:
        yield c


def admin_token(client):
    r = client.post("/api/auth/login", data={"username": "admin", "password": "TestAdmin@123"})
    assert r.status_code == 200
    return r.json()["access_token"]


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", data={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_login_rate_limit(client):
    for _ in range(5):
        client.post("/api/auth/login", data={"username": "admin", "password": "wrong"})
    r = client.post("/api/auth/login", data={"username": "admin", "password": "wrong"})
    assert r.status_code == 429


def test_add_voter_and_vote_flow(client):
    token = admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/admin/voters", json={"id": "V1", "full_name": "Alice", "pin": "1234", "constituency": "Ward 1"}, headers=headers)
    assert r.status_code == 200

    r = client.post("/api/votes/verify-identity", json={"voter_id": "V1", "pin": "1234"})
    assert r.status_code == 200
    session_token = r.json()["session_token"]

    r = client.post("/api/votes/cast", json={"voter_id": "V1", "party_id": "a", "session_token": session_token})
    assert r.status_code == 200
    assert r.json()["receipt"]["voter_id"] == "V1"

    # duplicate vote must be blocked
    r = client.post("/api/votes/verify-identity", json={"voter_id": "V1", "pin": "1234"})
    assert r.status_code == 409


def test_chain_verifies(client):
    token = admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/admin/voters", json={"id": "V2", "full_name": "Bob", "pin": "5678", "constituency": "Ward 1"}, headers=headers)
    v = client.post("/api/votes/verify-identity", json={"voter_id": "V2", "pin": "5678"}).json()
    client.post("/api/votes/cast", json={"voter_id": "V2", "party_id": "b", "session_token": v["session_token"]})

    r = client.get("/api/blockchain/verify")
    assert r.status_code == 200
    assert r.json()["valid"] is True


def test_bulk_voter_import(client):
    token = admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    csv_text = "id,full_name,pin,constituency\nV10,Carl,1111,Ward 2\nV11,Dana,2222,Ward 2\n"
    r = client.post("/api/admin/voters/bulk", json={"csv": csv_text}, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2


def test_voting_closed_blocks_cast(client):
    token = admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/admin/voters", json={"id": "V3", "full_name": "Eve", "pin": "0000", "constituency": "Ward 1"}, headers=headers)
    v = client.post("/api/votes/verify-identity", json={"voter_id": "V3", "pin": "0000"}).json()

    client.post("/api/admin/settings", json={"voting_open": False}, headers=headers)
    r = client.post("/api/votes/cast", json={"voter_id": "V3", "party_id": "a", "session_token": v["session_token"]})
    assert r.status_code == 403
