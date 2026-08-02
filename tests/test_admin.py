"""管理员用户管理测试：CRUD + 重复用户名 + 删自己保护 + 资源转交。"""


def test_admin_user_crud(client, admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    # 创建
    r = client.post("/api/admin/users", json={"username": "u1", "password": "pw"}, headers=h)
    assert r.status_code == 201
    uid = r.json()["id"]
    # 列表
    users = client.get("/api/admin/users", headers=h).json()
    assert "u1" in [u["username"] for u in users]
    # 删除
    assert client.delete(f"/api/admin/users/{uid}", headers=h).status_code == 204
    names = [u["username"] for u in client.get("/api/admin/users", headers=h).json()]
    assert "u1" not in names


def test_admin_duplicate_username_400(client, admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    client.post("/api/admin/users", json={"username": "dup", "password": "pw"}, headers=h)
    r = client.post("/api/admin/users", json={"username": "dup", "password": "pw2"}, headers=h)
    assert r.status_code == 400


def test_admin_cannot_delete_self(client, admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    me = client.get("/api/auth/me", headers=h).json()
    r = client.delete(f"/api/admin/users/{me['id']}", headers=h)
    assert r.status_code == 400


def test_admin_delete_transfers_resources(client, admin_token, create_user):
    """删除用户时其资源（位置/分类）应转交给管理员，不残留孤儿数据。"""
    token = create_user("victim")
    h = {"Authorization": f"Bearer {token}"}
    loc = client.post("/api/locations", json={"name": "受害者的位置"}, headers=h).json()

    # 管理员删除该用户
    users = client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"}).json()
    victim = next(u for u in users if u["username"] == "victim")
    assert client.delete(
        f"/api/admin/users/{victim['id']}",
        headers={"Authorization": f"Bearer {admin_token}"},
    ).status_code == 204

    # 位置归属转移到管理员
    admin_locs = client.get(
        "/api/locations", headers={"Authorization": f"Bearer {admin_token}"}
    ).json()
    assert any(l["id"] == loc["id"] for l in admin_locs)
