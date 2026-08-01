"""统一调度器管理：应用级定时任务（推送扫描 + 自动备份）的唯一启停入口。

约定：所有 BackgroundScheduler 的启动/停止都经由此模块编排，
services 层不得反向导入 routers 层。
"""
import logging

from app.services.backup import start_scheduler as start_backup
from app.services.backup import stop_scheduler as stop_backup
from app.services.push_scheduler import start_scheduler as start_push
from app.services.push_scheduler import stop_scheduler as stop_push

logger = logging.getLogger("homekeeper.scheduler")


def start_all() -> None:
    """启动全部调度器（FastAPI lifespan 启动时调用）。"""
    start_backup()
    start_push()
    logger.info("全部调度器已启动")


def stop_all() -> None:
    """停止全部调度器（FastAPI lifespan 结束 / 数据库恢复前调用）。"""
    stop_backup()
    stop_push()
    logger.info("全部调度器已停止")
