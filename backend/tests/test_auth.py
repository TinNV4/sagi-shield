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

def test_expired_and_foreign_tokens_are_401_never_500(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    from firebase_admin import auth as fb
    def boom(token):
        raise fb.ExpiredIdTokenError("expired", cause=None)
    monkeypatch.setattr(auth, "_verify_firebase_raw", boom)
    with pytest.raises(auth.AuthError) as e:
        auth.verify("t")
    assert e.value.status == 401 and "sign in again" in e.value.detail
    monkeypatch.setattr(auth, "_verify_firebase_raw", lambda t: (_ for _ in ()).throw(ValueError("wrong aud")))
    assert pytest.raises(auth.AuthError, auth.verify, "t").value.status == 401

def test_anonymous_token_is_a_device_even_with_a_name_claim(monkeypatch):
    monkeypatch.setenv("AUTH", "firebase")
    monkeypatch.setattr(auth, "_verify_firebase", lambda t: {"uid": "d", "name": "x", "firebase": {"sign_in_provider": "anonymous"}, "admin": True})
    assert auth.verify("t") == auth.Principal("d", "device", "x")   # admin claim on an anonymous user is ignored
