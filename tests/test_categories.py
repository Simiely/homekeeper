"""分类接口测试：CRUD + 404 + 多用户隔离。"""


def test_category_crud(client, create_user):
    token = create_user("catuser")
    h = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/categories", json={"name": "食品", "color": "#ff0000"}, headers=h)
    assert r.status_code == 201
    cid = r.json()["id"]
    assert r.json()["name"] == "食品"

    # 更新
    r2 = client.put(f"/api/categories/{cid}", json={"name": "零食"}, headers=h)
    assert r2.status_code == 200
    assert r2.json()["name"] == "零食"

    # 列表
    lst = client.get("/api/categories", headers=h).json()
    assert [c["name"] for c in lst] == ["零食"]

    # 删除
    assert client.delete(f"/api/categories/{cid}", headers=h).status_code == 204
    assert client.get("/api/categories", headers=h).json() == []


def test_category_not_found(client, create_user):
    token = create_user("cat404")
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/categories/99999", headers=h).status_code == 404
    assert client.put("/api/categories/99999", json={"name": "x"}, headers=h).status_code == 404
    assert client.delete("/api/categories/99999", headers=h).status_code == 404


def test_category_isolation(client, create_user):
    ta = create_user("catA")
    ca = client.post(
        "/api/categories", json={"name": "A的类"}, headers={"Authorization": f"Bearer {ta}"}
    ).json()
    tb = create_user("catB")
    # B 不能读/改/删 A 的分类
    hb = {"Authorization": f"Bearer {tb}"}
    assert client.get(f"/api/categories/{ca['id']}", headers=hb).status_code == 404
    assert client.put(f"/api/categories/{ca['id']}", json={"name": "x"}, headers=hb).status_code == 404
    assert client.delete(f"/api/categories/{ca['id']}", headers=hb).status_code == 404
