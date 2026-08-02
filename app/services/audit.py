"""SQLAlchemy 事件监听：自动记录物品变更日志。

设计：after_insert/after_update/before_delete 在业务事务的 flush 阶段同步触发，
此时业务连接仍持有写锁——因此日志必须用事件回调传入的 connection（同一事务）
写入，不能新开 SessionLocal 连接（SQLite 单写者，跨连接写会 database is locked）。
"""
import logging

from sqlalchemy import event, insert

from app.models.item import Item
from app.models.item_log import ItemLog

logger = logging.getLogger("homekeeper.audit")


def _log(connection, item: Item, action: str, summary: str = ""):
    """在同一事务连接上写日志（随业务一起 commit/rollback）。"""
    connection.execute(
        insert(ItemLog).values(
            item_id=item.id,
            user_id=item.owner_id,
            action=action,
            summary=summary,
        )
    )


def _changes(item: Item) -> str:
    """检测 Item 的变更字段，返回摘要。"""
    from sqlalchemy.orm.attributes import get_history

    parts = []
    # 检查每个字段是否有变化
    for attr in ["name", "description", "quantity", "unit", "status", "location_id",
                  "category_id", "expiry_date", "purchase_date", "price",
                  "serial_number", "warranty_expiry", "archived", "location_note"]:
        hist = get_history(item, attr)
        if hist.has_changes():
            old = _val(hist.deleted[0]) if hist.deleted else ""
            new = _val(hist.added[0]) if hist.added else ""
            # 跳过初始创建时的 None→值
            if old or new:
                parts.append(f"{attr}: {old} → {new}")
    return "；".join(parts) if parts else "信息已更新"


def _val(v):
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@event.listens_for(Item, "after_insert")
def on_item_insert(mapper, connection, target):
    _log(connection, target, "create", f"创建物品「{target.name}」")


@event.listens_for(Item, "after_update")
def on_item_update(mapper, connection, target):
    summary = _changes(target)
    if summary:
        _log(connection, target, "update", f"更新物品「{target.name}」: {summary}")


@event.listens_for(Item, "before_delete")
def on_item_delete(mapper, connection, target):
    _log(connection, target, "delete", f"删除物品「{target.name}」")
