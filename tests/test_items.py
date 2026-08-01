"""物品 CRUD 与多用户隔离测试。"""


def test_item_crud(client, create_user):
    token = create_user("tester")
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
    assert len(lst["items"]) == 1
    assert lst["total"] == 1

    # 更新状态
    r2 = client.put(f"/api/items/{iid}", json={"status": "已借出"}, headers=h)
    assert r2.json()["status"] == "已借出"

    # 过期提醒
    exp = client.get("/api/dashboard/expiring?days=30", headers=h).json()
    assert any(x["id"] == iid for x in exp["expiring"])

    # 删除
    client.delete(f"/api/items/{iid}", headers=h)
    res = client.get("/api/items", headers=h).json()
    assert len(res["items"]) == 0
    assert res["total"] == 0


def test_item_isolation(client, create_user):
    ta = create_user("userA")
    client.post(
        "/api/items", json={"name": "A的物品"}, headers={"Authorization": f"Bearer {ta}"}
    )

    tb = create_user("userB")
    lb = client.get("/api/items", headers={"Authorization": f"Bearer {tb}"}).json()
    assert len(lb["items"]) == 0


def test_item_filter(client, create_user):
    token = create_user("filteruser")
    h = {"Authorization": f"Bearer {token}"}
    loc = client.post("/api/locations", json={"name": "客厅"}, headers=h).json()
    cat = client.post("/api/categories", json={"name": "工具"}, headers=h).json()
    client.post(
        "/api/items",
        json={
            "name": "螺丝刀",
            "location_id": loc["id"],
            "category_id": cat["id"],
            "status": "在库",
        },
        headers=h,
    )
    client.post("/api/items", json={"name": "牛奶", "status": "已借出"}, headers=h)

    r1 = client.get("/api/items?keyword=螺丝", headers=h).json()
    assert len(r1["items"]) == 1 and r1["items"][0]["name"] == "螺丝刀"

    r2 = client.get(f"/api/items?category_id={cat['id']}", headers=h).json()
    assert len(r2["items"]) == 1 and r2["items"][0]["name"] == "螺丝刀"

    r3 = client.get(f"/api/items?location_id={loc['id']}", headers=h).json()
    assert len(r3["items"]) == 1

    r4 = client.get("/api/items?status_filter=已借出", headers=h).json()
    assert len(r4["items"]) == 1 and r4["items"][0]["name"] == "牛奶"

    r5 = client.get("/api/items?keyword=螺丝&status_filter=在库", headers=h).json()
    assert len(r5["items"]) == 1
