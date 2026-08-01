"""位置拖拽排序（reorder）接口测试：正常重排 / 环检测 / 越权校验 / 新位置排序。"""


def _mk_loc(client, token, name, parent_id=None):
    r = client.post(
        "/api/locations",
        json={"name": name, "parent_id": parent_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_reorder_normal(client, create_user):
    token = create_user("locuser")
    h = {"Authorization": f"Bearer {token}"}
    a = _mk_loc(client, token, "A")
    b = _mk_loc(client, token, "B", a["id"])
    c = _mk_loc(client, token, "C", b["id"])

    # B 提升为顶级，C 仍挂 B 下，A 保持顶级
    r = client.put(
        "/api/locations/reorder",
        json=[
            {"id": a["id"], "parent_id": None, "sort_order": 0},
            {"id": b["id"], "parent_id": None, "sort_order": 1},
            {"id": c["id"], "parent_id": b["id"], "sort_order": 0},
        ],
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 3

    locs = {l["id"]: l for l in client.get("/api/locations", headers=h).json()}
    assert locs[a["id"]]["parent_id"] is None
    assert locs[b["id"]]["parent_id"] is None
    assert locs[c["id"]]["parent_id"] == b["id"]


def test_reorder_cycle_detection(client, create_user):
    """把 A 放入 C 下：现有链路 C>B>A（跨 payload 之外的节点），必须拒绝。"""
    token = create_user("cycleuser")
    h = {"Authorization": f"Bearer {token}"}
    a = _mk_loc(client, token, "A")
    b = _mk_loc(client, token, "B", a["id"])
    c = _mk_loc(client, token, "C", b["id"])

    r = client.put(
        "/api/locations/reorder",
        json=[{"id": a["id"], "parent_id": c["id"], "sort_order": 0}],
        headers=h,
    )
    assert r.status_code == 400
    # 数据未被破坏
    locs = {l["id"]: l for l in client.get("/api/locations", headers=h).json()}
    assert locs[a["id"]]["parent_id"] is None


def test_reorder_unauthorized_id(client, create_user):
    token = create_user("authuser")
    h = {"Authorization": f"Bearer {token}"}
    r = client.put(
        "/api/locations/reorder",
        json=[{"id": 99999, "parent_id": None, "sort_order": 0}],
        headers=h,
    )
    assert r.status_code == 400


def test_new_location_gets_next_sort_order(client, create_user):
    token = create_user("sorter")
    h = {"Authorization": f"Bearer {token}"}
    x = _mk_loc(client, token, "X")
    y = _mk_loc(client, token, "Y")
    z = _mk_loc(client, token, "Z")
    # 同级自动排到末尾：sort_order 严格递增
    assert x["sort_order"] < y["sort_order"] < z["sort_order"]
