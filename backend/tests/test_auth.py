import logging
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from app import auth

def test_fake_tokens_map_to_roles(monkeypatch):
    monkeypatch.setenv("AUTH", "fake")
    assert auth.verify("fake:d1:anonymous") == auth.Principal("d1", "device")
    assert auth.verify("fake:g1:google.com").role == "guardian"
    assert auth.verify("fake:a1:phone:admin").role == "admin"
    with pytest.raises(auth.AuthError) as e:
        auth.verify("fake:x")
    assert e.value.status == 401

def test_fake_mode_is_refused_on_firestore(monkeypatch):
    monkeypatch.setenv("AUTH", "fake"); monkeypatch.setenv("STORE", "firestore")
    assert auth.mode() == "firebase"

def test_firebase_claims_are_mapped(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    claims = {"uid": "u1", "name": "Taro Yamada", "firebase": {"sign_in_provider": "google.com"}}
    monkeypatch.setattr(auth, "_verify_firebase", lambda token: claims)
    assert auth.verify("x") == auth.Principal("u1", "guardian", "Taro Yamada")
    monkeypatch.setattr(auth, "_verify_firebase", lambda token: {**claims, "admin": True})
    assert auth.verify("x").role == "admin"

def test_dependencies(monkeypatch):
    monkeypatch.setenv("AUTH", "fake")
    app = FastAPI()
    @app.get("/who")
    def who(p: auth.Principal = Depends(auth.principal)): return p.role
    @app.get("/g")
    def g(p: auth.Principal = Depends(auth.guardian_or_admin)): return p.role
    @app.get("/a")
    def a(p: auth.Principal = Depends(auth.admin_only)): return p.role
    c = TestClient(app)
    assert c.get("/who").status_code == 401
    assert c.get("/who", headers={"Authorization": "Bearer fake:d:anonymous"}).json() == "device"
    assert c.get("/g", headers={"Authorization": "Bearer fake:d:anonymous"}).status_code == 403
    assert c.get("/g", headers={"Authorization": "Bearer fake:g:phone"}).status_code == 200
    assert c.get("/a", headers={"Authorization": "Bearer fake:g:phone"}).status_code == 403
    assert c.get("/a", headers={"Authorization": "Bearer fake:g:phone:admin"}).status_code == 200
    assert c.get("/who", headers={"Authorization": "Bearer nonsense"}).status_code == 401

def test_expired_and_foreign_tokens_are_401_never_500(monkeypatch, caplog):
    monkeypatch.setenv("AUTH", "firebase")
    from firebase_admin import auth as fb
    def boom(token):
        raise fb.ExpiredIdTokenError("expired", cause=None)
    monkeypatch.setattr(auth, "_verify_firebase_raw", boom)
    with pytest.raises(auth.AuthError) as e:
        auth.verify("t")
    assert e.value.status == 401 and "sign in again" in e.value.detail
    def foreign(token):
        raise fb.InvalidIdTokenError("wrong aud")
    monkeypatch.setattr(auth, "_verify_firebase_raw", foreign)
    assert pytest.raises(auth.AuthError, auth.verify, "t").value.status == 401
    def no_project(token):
        raise ValueError("Failed to ascertain project ID")
    monkeypatch.setattr(auth, "_verify_firebase_raw", no_project)
    with caplog.at_level(logging.WARNING, logger="sagi.auth"):
        e = pytest.raises(auth.AuthError, auth.verify, "t").value
    assert e.status == 503
    assert any(r.levelno >= logging.WARNING for r in caplog.records)

def test_server_side_fault_is_503_through_dependency_and_none_for_socket(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    def broken(token):
        raise RuntimeError("network down")
    monkeypatch.setattr(auth, "_verify_firebase_raw", broken)
    app = FastAPI()
    @app.get("/who")
    def who(p: auth.Principal = Depends(auth.principal)): return p.role
    assert TestClient(app).get("/who", headers={"Authorization": "Bearer t"}).status_code == 503
    assert auth.principal_from_query("t") is None

def test_anonymous_token_is_a_device_even_with_a_name_claim(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    monkeypatch.setattr(auth, "_verify_firebase", lambda t: {"uid": "d", "name": "x", "firebase": {"sign_in_provider": "anonymous"}, "admin": True})
    assert auth.verify("t") == auth.Principal("d", "device", "x")   # admin claim on an anonymous user is ignored

def test_off_mode_is_refused_on_firestore(monkeypatch):
    monkeypatch.setenv("AUTH", "off"); monkeypatch.setenv("STORE", "firestore")
    assert auth.mode() == "firebase"
    monkeypatch.setenv("STORE", "memory")
    assert auth.mode() == "off"

def test_off_mode_makes_every_request_a_nameless_device(monkeypatch):
    monkeypatch.setenv("AUTH", "off"); monkeypatch.setenv("STORE", "memory")
    nobody = auth.Principal("", "device")
    assert auth.verify("") == nobody and auth.verify("anything") == nobody
    assert auth.principal_from_query(None) == nobody
    app = FastAPI()
    @app.get("/who")
    def who(p: auth.Principal = Depends(auth.principal)): return p.role
    @app.get("/opt")
    def opt(p=Depends(auth.optional_principal)): return p.role if p else None
    @app.get("/g")
    def g(p: auth.Principal = Depends(auth.guardian_or_admin)): return p.role
    @app.get("/a")
    def a(p: auth.Principal = Depends(auth.admin_only)): return p.role
    c = TestClient(app)
    assert c.get("/who").json() == "device"
    assert c.get("/opt").json() == "device"
    assert c.get("/who", headers={"Authorization": "Bearer fake:g:phone:admin"}).json() == "device"
    assert c.get("/g").status_code == 403
    assert c.get("/a").status_code == 403
