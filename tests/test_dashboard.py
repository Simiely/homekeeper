"""仪表盘接口测试：临期分段 + 已清理/已丢弃过滤 + 保修 + 统计。"""


def _mk_item(client, token, name, **extra):
    r = client.post(
        "/api/items",
        json={"name": name, "status": "在库", "quantity": 1, **extra},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_expiring_segments_and_terminal_filter(client, create_user):
    """临期清单：只含未归档且非终态；已过期/即将过期正确分段。"""
    token = create_user("dashuser")
    h = {"Authorization": f"Bearer {token}"}

    _mk_item(client, token, "过期品", expiry_date="2020-01-01")  # 已过期
    _mk_item(client, token, "临期品", expiry_date="2030-01-01")  # 未来
    _mk_item(client, token, "已清理品", expiry_date="2020-01-01", status="已处理")
    _mk_item(client, token, "已丢弃品", expiry_date="2020-01-01", status="损坏丢弃")
    _mk_item(client, token, "归档品", expiry_date="2020-01-01", archived=True)

    data = client.get("/api/dashboard/expiring?days=3650", headers=h).json()
    names = [i["name"] for i in data["expiring"]]

    # 终态与归档不出现
    assert "已清理品" not in names
    assert "已丢弃品" not in names
    assert "归档品" not in names
    # 有效的两条保留
    assert set(names) == {"过期品", "临期品"}

    # 分段标记正确
    by_name = {i["name"]: i for i in data["expiring"]}
    assert by_name["过期品"]["expired"] is True
    assert by_name["过期品"]["days_left"] < 0
    assert by_name["临期品"]["expired"] is False
    assert by_name["临期品"]["days_left"] > 0


def test_warranty_expiring(client, create_user):
    token = create_user("warrantyuser")
    h = {"Authorization": f"Bearer {token}"}
    _mk_item(client, token, "保修品", warranty_expiry="2020-01-01")
    _mk_item(client, token, "保修已清理", warranty_expiry="2020-01-01", status="已处理")

    data = client.get("/api/dashboard/expiring?days=3650", headers=h).json()
    names = [i["name"] for i in data["warranty_expiring"]]
    assert names == ["保修品"]  # 已清理的保修同样被排除


def test_summary_stats(client, create_user):
    token = create_user("summaryuser")
    h = {"Authorization": f"Bearer {token}"}
    _mk_item(client, token, "A", price=100, quantity=2)
    _mk_item(client, token, "B", price=50, quantity=1)

    s = client.get("/api/dashboard/summary", headers=h).json()
    assert s["total"] == 2
    assert s["total_value"] == 250.0
