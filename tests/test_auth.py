"""认证相关测试。"""


def test_register_login_me(client):
    username = "alice"
    pwd = "secret123"

    # 注册
    r = client.post(
        "/api/auth/register", json={"username": username, "password": pwd}
    )
    assert r.status_code == 200
    token = r.json()["access_token"]
    assert token

    # 重复注册应冲突
    r2 = client.post(
        "/api/auth/register", json={"username": username, "password": pwd}
    )
    assert r2.status_code == 400

    # 当前用户
    r3 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    assert r3.json()["username"] == username


def test_login_wrong_password(client):
    client.post("/api/auth/register", json={"username": "bob", "password": "pw"})
    r = client.post("/api/auth/login", data={"username": "bob", "password": "wrong"})
    assert r.status_code == 401


def test_protected_without_token(client):
    r = client.get("/api/items")
    assert r.status_code == 401
