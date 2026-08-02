"""数据导入导出测试：CSV/ZIP 导出 + CSV 导入（写测试库，不碰真实数据）。"""
import io

from fastapi.testclient import TestClient  # noqa: F401


def _mk_item(client, token, name, **extra):
    r = client.post(
        "/api/items",
        json={"name": name, "quantity": 1, **extra},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_export_items_csv(client, create_user):
    token = create_user("csvuser")
    h = {"Authorization": f"Bearer {token}"}
    _mk_item(client, token, "咖啡", quantity=2, unit="袋")

    r = client.get("/api/export/items", headers=h)
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    text = r.text
    assert "咖啡" in text
    assert text.startswith("name,")  # CSV 表头为英文列名


def test_export_all_zip(client, create_user):
    token = create_user("zipuser")
    h = {"Authorization": f"Bearer {token}"}
    _mk_item(client, token, "数据品")

    r = client.get("/api/export/all", headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    import zipfile

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert any(n.endswith("items.csv") for n in names)
    assert any(n.endswith("locations.csv") for n in names)


def test_import_items_csv(client, create_user):
    token = create_user("impuser")
    h = {"Authorization": f"Bearer {token}"}
    csv_text = "name,quantity,unit\n导入茶,3,盒\n导入书,1,本\n"
    r = client.post(
        "/api/import/items",
        files={"file": ("items.csv", io.BytesIO(csv_text.encode("utf-8-sig")), "text/csv")},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 2

    lst = client.get("/api/items", headers=h).json()
    assert lst["total"] == 2


def test_import_items_bad_csv(client, create_user):
    token = create_user("impbad")
    h = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/api/import/items",
        files={"file": ("bad.csv", io.BytesIO(b"not a csv at all"), "text/csv")},
        headers=h,
    )
    assert r.status_code == 400
