"""物品 CRUD 与多用户隔离测试。"""


def _login(client, username):
    client.post("/api/auth/register", json={"username": username, "password": "pw"})
    return client.post(
        "/api/auth/login", data={"username": username, "password": "pw"}
    ).json()["access_token"]


def test_item_crud(client):
    token = _login(client, "tester")
    h = {"Authorization": f"Bearer {token}"}

    # 建位置（层级 + 备注）
    loc = client.post("/api/locations", json={"name": "厨房"}, headers=h).json()

    # 建物品
    r = client.post(
        "/api/items",
        json={
            "name": "牛奶",
            "location_id": loc["id"],
            "location_note": "上层",
            "expiry_date": "2026-08-01",
            "status": "在库",
        },
        headers=h,
    )
    assert r.status_code == 201
    item = r.json()
    assert item["name"] == "牛奶"
    iid = item["id"]

    # 列表
    lst = client.get("/api/items", headers=h).json()
    assert len(lst) == 1

    # 更新状态
    r2 = client.put(f"/api/items/{iid}", json={"status": "已借出"}, headers=h)
    assert r2.json()["status"] == "已借出"

    # 过期提醒
    exp = client.get("/api/dashboard/expiring?days=30", headers=h).json()
    assert any(x["id"] == iid for x in exp)

    # 删除
    client.delete(f"/api/items/{iid}", headers=h)
    assert len(client.get("/api/items", headers=h).json()) == 0


def test_item_isolation(client):
    ta = _login(client, "userA")
    client.post(
        "/api/items", json={"name": "A的物品"}, headers={"Authorization": f"Bearer {ta}"}
    )

    tb = _login(client, "userB")
    lb = client.get("/api/items", headers={"Authorization": f"Bearer {tb}"}).json()
    assert len(lb) == 0
