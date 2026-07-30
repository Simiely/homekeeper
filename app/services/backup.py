"""自动备份：定时备份 SQLite + 列表/恢复。"""
import logging
import shutil
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, HTTPException

from app.config import DATA_DIR, settings
from app.database import engine, init_db
from app.routers.push import start_scheduler as start_push_scheduler
from app.routers.push import stop_scheduler as stop_push_scheduler

logger = logging.getLogger("homekeeper.backup")
router = APIRouter(prefix="/api/backups", tags=["backups"])

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
    """从备份文件恢复数据库。"""
    backup = BACKUP_DIR / filename
    if not backup.exists() or not backup.name.startswith("homekeeper_"):
        raise HTTPException(status_code=404, detail="备份文件不存在")

    logger.warning("正在从 %s 恢复数据库...", filename)

    # 停调度器
    stop_push_scheduler()

    # 断开所有数据库连接
    engine.dispose()

    # 复制备份覆盖当前数据库
    shutil.copy2(backup, DB_PATH)

    # 重新建表（原表已存在不会覆盖数据）
    init_db()

    # 重启调度器
    start_push_scheduler()

    logger.warning("数据库已从 %s 恢复", filename)


# ========== API 端点 ==========


@router.get("")
def list_backups():
    """获取备份列表。"""
    return {
        "backups": list_backup_files(),
        "backup_dir": str(BACKUP_DIR),
        "db_path": str(DB_PATH),
    }


@router.post("/trigger")
def trigger_backup():
    """手动触发一次备份。"""
    filename = create_backup()
    if filename:
        return {"ok": True, "filename": filename}
    return {"ok": False, "reason": "数据库为空，跳过备份"}


@router.post("/{filename}/restore")
def restore(filename: str):
    """从指定的备份文件恢复数据库（危险操作）。"""
    restore_backup(filename)
    return {"ok": True, "restored_from": filename}


# ========== 调度器 ==========

scheduler = BackgroundScheduler()


def start_scheduler():
    """在 lifespan 中调用，启动自动备份。"""
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
    """在 lifespan 结束时调用。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("备份调度器已停止")
