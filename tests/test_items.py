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
    r2 = client.put(f"/api/items/{iid}", json={"status": "临期"}, headers=h)
    assert r2.json()["status"] == "临期"

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
    client.post("/api/items", json={"name": "牛奶", "status": "临期"}, headers=h)

    r1 = client.get("/api/items?keyword=螺丝", headers=h).json()
    assert len(r1["items"]) == 1 and r1["items"][0]["name"] == "螺丝刀"

    r2 = client.get(f"/api/items?category_id={cat['id']}", headers=h).json()
    assert len(r2["items"]) == 1 and r2["items"][0]["name"] == "螺丝刀"

    r3 = client.get(f"/api/items?location_id={loc['id']}", headers=h).json()
    assert len(r3["items"]) == 1

    r4 = client.get("/api/items?status_filter=临期", headers=h).json()
    assert len(r4["items"]) == 1 and r4["items"][0]["name"] == "牛奶"

    r5 = client.get("/api/items?keyword=螺丝&status_filter=在库", headers=h).json()
    assert len(r5["items"]) == 1


def test_item_sort_and_multi_tag(client, create_user):
    token = create_user("sortuser")
    h = {"Authorization": f"Bearer {token}"}

    # 位置（排序用：先建「冰箱」后建「玄关」，验证按位置 sort_order 排序）
    loc_fridge = client.post("/api/locations", json={"name": "冰箱"}, headers=h).json()
    loc_entry = client.post("/api/locations", json={"name": "玄关"}, headers=h).json()
    cat_a = client.post("/api/categories", json={"name": "食品"}, headers=h).json()
    cat_b = client.post("/api/categories", json={"name": "百货"}, headers=h).json()
    tag_a = client.post("/api/tags", json={"name": "常用"}, headers=h).json()
    tag_b = client.post("/api/tags", json={"name": "备用"}, headers=h).json()

    # 3 件：过期日期不同、位置不同、分类不同、标签交集/并集不同
    it1 = client.post(
        "/api/items",
        json={"name": "牛奶", "expiry_date": "2026-09-01", "location_id": loc_fridge["id"], "category_id": cat_a["id"]},
        headers=h,
    ).json()
    it2 = client.post(
        "/api/items",
        json={"name": "雨伞", "expiry_date": "2026-08-10", "location_id": loc_entry["id"], "category_id": cat_b["id"]},
        headers=h,
    ).json()
    it3 = client.post("/api/items", json={"name": "无保质期", "category_id": cat_b["id"]}, headers=h).json()
    # 打标签：牛奶=常用+备用；雨伞=备用
    client.post(f"/api/items/{it1['id']}/tags/{tag_a['id']}", headers=h)
    client.post(f"/api/items/{it1['id']}/tags/{tag_b['id']}", headers=h)
    client.post(f"/api/items/{it2['id']}/tags/{tag_b['id']}", headers=h)

    # 按保质期升序：雨伞(08-10) → 牛奶(09-01) → 无保质期（最后）
    r = client.get("/api/items?sort=expiry", headers=h).json()
    assert [i["name"] for i in r["items"]] == ["雨伞", "牛奶", "无保质期"]

    # 按位置排序（sort_order 升序）：先建=sort_order 小 → 冰箱组在前
    r = client.get("/api/items?sort=location", headers=h).json()
    names = [i["name"] for i in r["items"]]
    assert names.index("牛奶") < names.index("雨伞")
    # 无位置的最后
    assert names[-1] == "无保质期"

    # 按分类名排序（中文按 Unicode 码点：百货 < 食品）：同类相邻、同分类内按最新在前
    r = client.get("/api/items?sort=category", headers=h).json()
    names = [i["name"] for i in r["items"]]
    assert set(names[:2]) == {"雨伞", "无保质期"}  # 百货组相邻
    assert names[-1] == "牛奶"  # 食品组在最后

    # 标签多选（并集）：备用 → 牛奶+雨伞；常用+备用 → 仍是牛奶+雨伞
    r = client.get(f"/api/items?tag_ids={tag_b['id']}", headers=h).json()
    assert {i["name"] for i in r["items"]} == {"牛奶", "雨伞"}
    r = client.get(f"/api/items?tag_ids={tag_a['id']}&tag_ids={tag_b['id']}", headers=h).json()
    assert {i["name"] for i in r["items"]} == {"牛奶", "雨伞"}
    # 仅常用 → 牛奶
    r = client.get(f"/api/items?tag_ids={tag_a['id']}", headers=h).json()
    assert [i["name"] for i in r["items"]] == ["牛奶"]

    # 非法 sort 值 → 422
    assert client.get("/api/items?sort=xxx", headers=h).status_code == 422
