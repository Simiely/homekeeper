"""认证相关测试（v0.8.0 起无公开注册，用户由管理员创建）。"""


def test_register_endpoint_disabled(client):
    """公开注册接口已移除，应返回 405。"""
    r = client.post(
        "/api/auth/register", json={"username": "alice", "password": "secret123"}
    )
    assert r.status_code == 405


def test_admin_create_login_me(client, create_user):
    token = create_user("alice", "secret123")
    assert token

    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


def test_admin_create_duplicate_returns_400(client, admin_token):
    payload = {"username": "alice", "password": "pw"}
    headers = {"Authorization": f"Bearer {admin_token}"}
    assert client.post("/api/admin/users", json=payload, headers=headers).status_code == 201
    r = client.post("/api/admin/users", json=payload, headers=headers)
    assert r.status_code == 400


def test_login_wrong_password(client, create_user):
    create_user("bob")
    r = client.post("/api/auth/login", data={"username": "bob", "password": "wrong"})
    assert r.status_code == 401


def test_protected_without_token(client):
    r = client.get("/api/items")
    assert r.status_code == 401
