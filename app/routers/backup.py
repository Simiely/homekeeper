"""备份 API：列表 / 手动触发 / 恢复（恢复时暂停全部调度器）。

职责边界：本模块只做 HTTP 编排；备份业务见 services/backup.py，
调度器统一管理见 services/scheduler.py。
"""
from fastapi import APIRouter, Depends

from app.deps import get_admin_user, get_current_user
from app.models.user import User
from app.services import scheduler as scheduler_mgr
from app.services.backup import BACKUP_DIR, DB_PATH, create_backup, list_backup_files, restore_backup

router = APIRouter(prefix="/api/backups", tags=["backups"])


@router.get("")
def list_backups(user: User = Depends(get_current_user)):
    """获取备份列表（需登录）。"""
    return {
        "backups": list_backup_files(),
        "backup_dir": str(BACKUP_DIR),
        "db_path": str(DB_PATH),
    }


@router.post("/trigger")
def trigger_backup(admin: User = Depends(get_admin_user)):
    """手动触发一次备份（仅管理员）。"""
    filename = create_backup()
    if filename:
        return {"ok": True, "filename": filename}
    return {"ok": False, "reason": "数据库为空，跳过备份"}


@router.post("/{filename}/restore")
def restore(filename: str, admin: User = Depends(get_admin_user)):
    """从指定的备份文件恢复数据库（危险操作，仅管理员）。

    恢复期间暂停全部调度器（自动备份 + 推送扫描），完成后重启。
    """
    scheduler_mgr.stop_all()
    try:
        restore_backup(filename)
    finally:
        scheduler_mgr.start_all()
    return {"ok": True, "restored_from": filename}
