"""SQLAlchemy 事件监听：自动记录物品变更日志。"""
import logging

from sqlalchemy import event

from app.models.item import Item

logger = logging.getLogger("homekeeper.audit")


def _log(item: Item, action: str, summary: str = ""):
    """写入日志记录（延迟导入避免循环）。"""
    from app.database import SessionLocal
    from app.models.item_log import ItemLog

    db = SessionLocal()
    try:
        db.add(
            ItemLog(
                item_id=item.id,
                user_id=item.owner_id,
                action=action,
                summary=summary,
            )
        )
        db.commit()
    except Exception:
        logger.exception("写入操作日志失败")
    finally:
        db.close()


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
    _log(target, "create", f"创建物品「{target.name}」")


@event.listens_for(Item, "after_update")
def on_item_update(mapper, connection, target):
    summary = _changes(target)
    if summary:
        _log(target, "update", f"更新物品「{target.name}」: {summary}")


@event.listens_for(Item, "before_delete")
def on_item_delete(mapper, connection, target):
    _log(target, "delete", f"删除物品「{target.name}」")
