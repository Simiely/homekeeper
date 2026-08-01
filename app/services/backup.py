"""自动备份业务：定时备份 SQLite + 列表/恢复。

职责边界：本模块只做业务与调度，不定义任何 API 路由（见 routers/backup.py）；
调度器统一启停见 services/scheduler.py。
"""
import logging
import shutil
import sqlite3
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import HTTPException

from app.config import DATA_DIR, settings
from app.database import engine, init_db

logger = logging.getLogger("homekeeper.backup")

# [local-dev] 原仓库为 Path("/app/data/backups") / Path("/app/data/homekeeper.db")，Docker 内路径
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "homekeeper.db"


# ========== 备份逻辑 ==========


def create_backup() -> str | None:
    """执行备份，返回备份文件名，空库时返回 None。"""
    if not DB_PATH.exists() or DB_PATH.stat().st_size < 1024:
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"homekeeper_{ts}.db"
    dst = BACKUP_DIR / filename
    shutil.copy2(DB_PATH, dst)

    # 删除超出保留数的旧备份
    retention = max(settings.backup_retention, 1)
    backups = sorted(BACKUP_DIR.glob("homekeeper_*.db"), key=lambda p: p.name, reverse=True)
    for old in backups[retention:]:
        old.unlink()
        logger.info("清理旧备份: %s", old.name)

    logger.info("备份完成: %s", filename)
    return filename


def list_backup_files() -> list[dict]:
    """返回备份文件列表（元数据）。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(BACKUP_DIR.glob("homekeeper_*.db"), key=lambda p: p.name, reverse=True)
    return [
        {
            "filename": f.name,
            "size": f.stat().st_size,
            "created_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
        }
        for f in files
    ]


def restore_backup(filename: str) -> None:
    """从备份文件恢复数据库。

    注意：调度器（自动备份/推送扫描）的暂停与重启由 routers/backup.py 编排，
    本函数只负责数据层的安全恢复。
    """
    backup = BACKUP_DIR / filename
    if not backup.exists() or not backup.name.startswith("homekeeper_"):
        raise HTTPException(status_code=404, detail="备份文件不存在")

    logger.warning("正在从 %s 恢复数据库...", filename)

    # 断开所有数据库连接，避免占用文件
    engine.dispose()

    # 原子恢复：先写临时文件再替换，避免中途崩溃产生损坏库
    tmp = DB_PATH.with_suffix(".db.restore_tmp")
    shutil.copy2(backup, tmp)

    # 完整性校验：确认备份可正常打开
    try:
        conn = sqlite3.connect(tmp)
        row = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()
        if not row or row[0] != "ok":
            tmp.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="备份文件损坏，恢复已中止")
    except sqlite3.Error as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"备份文件无法打开：{e}")

    tmp.replace(DB_PATH)

    # 重新建表（原表已存在不会覆盖数据）
    init_db()
    logger.warning("数据库已从 %s 恢复", filename)


# ========== 调度器 ==========

scheduler = BackgroundScheduler()


def start_scheduler():
    """注册并启动自动备份任务（由 services/scheduler.py 统一调用）。"""
    if scheduler.get_job("db_backup"):
        return
    interval = max(settings.backup_interval_hours, 1)
    scheduler.add_job(
        create_backup,
        "interval",
        hours=interval,
        id="db_backup",
        next_run_time=None,
    )
    scheduler.start()
    logger.info("备份调度器已启动（每 %s 小时）", interval)


def stop_scheduler():
    """停止自动备份任务（由 services/scheduler.py 统一调用）。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("备份调度器已停止")
