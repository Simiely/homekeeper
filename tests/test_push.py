"""Web Push 接口测试：VAPID 公钥 + 订阅/退订（不真实发送推送）。"""
from fastapi.testclient import TestClient  # noqa: F401

SUB_BODY = {
    "endpoint": "https://example.com/push/abc",
    "auth_key": "a" * 24,
    "p256dh_key": "b" * 65,
}


def test_subscribe_unsubscribe(client, create_user, monkeypatch, tmp_path):
    # 隔离 VAPID 密钥文件到临时目录（避免写真实 data/vapid.json）
    import app.services.push_scheduler as ps

    monkeypatch.setattr(ps, "VAPID_FILE", tmp_path / "vapid.json")

    token = create_user("pushuser")
    h = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/push/subscribe", json=SUB_BODY, headers=h)
    assert r.status_code == 201

    # 重复订阅（幂等 upsert）仍成功
    assert client.post("/api/push/subscribe", json=SUB_BODY, headers=h).status_code == 201

    # VAPID 公钥下发
    r2 = client.get("/api/push/vapid-public-key")
    assert r2.status_code == 200
    assert len(r2.json()["public_key"]) > 20

    # 退订
    assert client.post("/api/push/unsubscribe", json=SUB_BODY, headers=h).status_code == 204


def test_subscribe_requires_auth(client):
    r = client.post("/api/push/subscribe", json=SUB_BODY)
    assert r.status_code == 401
