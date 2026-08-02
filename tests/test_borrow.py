"""借用接口测试：CRUD + 归还 + 404 + 越权。"""


def _mk_item(client, token, name="物品"):
    r = client.post(
        "/api/items", json={"name": name}, headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 201
    return r.json()


def test_borrow_crud_and_return(client, create_user):
    token = create_user("borrowuser")
    h = {"Authorization": f"Bearer {token}"}
    item = _mk_item(client, token)

    r = client.post(
        f"/api/items/{item['id']}/borrows",
        json={"borrower_name": "张三", "borrow_date": "2026-08-01"},
        headers=h,
    )
    assert r.status_code == 201
    bid = r.json()["id"]

    # 列表含未归还
    lst = client.get(f"/api/items/{item['id']}/borrows", headers=h).json()
    assert len(lst) == 1 and lst[0]["return_date"] is None

    # 归还
    r2 = client.put(
        f"/api/items/{item['id']}/borrows/{bid}",
        json={"return_date": "2026-08-05"},
        headers=h,
    )
    assert r2.status_code == 200
    assert r2.json()["return_date"] == "2026-08-05"

    # 删除
    assert client.delete(f"/api/items/{item['id']}/borrows/{bid}", headers=h).status_code == 204
    assert client.get(f"/api/items/{item['id']}/borrows", headers=h).json() == []


def test_borrow_not_found_and_missing_item(client, create_user):
    token = create_user("borrow404")
    h = {"Authorization": f"Bearer {token}"}
    item = _mk_item(client, token)
    # 物品不存在 → 404
    assert client.get("/api/items/99999/borrows", headers=h).status_code == 404
    # 借用记录不存在 → 404
    assert client.put(f"/api/items/{item['id']}/borrows/99999", json={"notes": "x"}, headers=h).status_code == 404


def test_borrow_isolation(client, create_user):
    ta = create_user("borrowA")
    item = _mk_item(client, ta, "A的物品")
    client.post(
        f"/api/items/{item['id']}/borrows",
        json={"borrower_name": "李四", "borrow_date": "2026-08-01"},
        headers={"Authorization": f"Bearer {ta}"},
    )
    tb = create_user("borrowB")
    hb = {"Authorization": f"Bearer {tb}"}
    # B 无法访问 A 物品的借用
    assert client.get(f"/api/items/{item['id']}/borrows", headers=hb).status_code == 404
