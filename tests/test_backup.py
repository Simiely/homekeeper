"""备份接口测试：触发/列表/恢复 404（目录重定向到临时路径，不碰真实数据）。"""


def test_backup_trigger_and_list(client, admin_token, monkeypatch, tmp_path):
    # 重定向备份目录与数据库路径到临时目录，避免操作真实 data/
    import os
    import shutil

    import app.services.backup as backup

    tmp_db = os.environ["DATABASE_URL"].replace("sqlite:///", "")
    shutil.copy2(tmp_db, tmp_path / "homekeeper.db")
    monkeypatch.setattr(backup, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup, "DB_PATH", tmp_path / "homekeeper.db")

    h = {"Authorization": f"Bearer {admin_token}"}

    r = client.post("/api/backups/trigger", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    lst = client.get("/api/backups", headers=h).json()
    assert len(lst["backups"]) == 1
    assert lst["backups"][0]["filename"].startswith("homekeeper_")

    # 恢复不存在的备份 → 404
    r2 = client.post("/api/backups/不存在的文件.db/restore", headers=h)
    assert r2.status_code == 404
