"""标签接口测试：CRUD + 404 + 物品标签关联。"""


def test_tag_crud_and_item_assoc(client, create_user):
    token = create_user("taguser")
    h = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/tags", json={"name": "易碎", "color": "#00ff00"}, headers=h)
    assert r.status_code == 201
    tid = r.json()["id"]

    # 标签挂到物品上（204 No Content）
    item = client.post("/api/items", json={"name": "玻璃杯"}, headers=h).json()
    assert client.post(f"/api/items/{item['id']}/tags/{tid}", headers=h).status_code == 204
    got = client.get(f"/api/items/{item['id']}", headers=h).json()
    assert tid in [t["id"] for t in got["tags"]]

    # 移除标签（204）
    assert client.delete(f"/api/items/{item['id']}/tags/{tid}", headers=h).status_code == 204
    got2 = client.get(f"/api/items/{item['id']}", headers=h).json()
    assert got2["tags"] == []

    # 删除标签
    assert client.delete(f"/api/tags/{tid}", headers=h).status_code == 204
    assert client.get("/api/tags", headers=h).json() == []


def test_tag_not_found(client, create_user):
    token = create_user("tag404")
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/tags/99999", headers=h).status_code == 404
    assert client.put("/api/tags/99999", json={"name": "x"}, headers=h).status_code == 404
    assert client.delete("/api/tags/99999", headers=h).status_code == 404
    # 给不存在的物品加标签 → 404
    assert client.post("/api/items/99999/tags/99999", headers=h).status_code == 404


def test_tag_isolation(client, create_user):
    ta = create_user("tagA")
    tg = client.post(
        "/api/tags", json={"name": "A的标签"}, headers={"Authorization": f"Bearer {ta}"}
    ).json()
    tb = create_user("tagB")
    hb = {"Authorization": f"Bearer {tb}"}
    assert client.get(f"/api/tags/{tg['id']}", headers=hb).status_code == 404
    assert client.delete(f"/api/tags/{tg['id']}", headers=hb).status_code == 404
