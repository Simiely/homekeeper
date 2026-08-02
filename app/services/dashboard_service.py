"""仪表盘统计业务：SQL 聚合概览 + 即将过期/保修到期提醒。"""
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.item import Item
from app.models.user import User


def get_summary(db: Session, user: User) -> dict:
    """统计概览：全部改为 SQL 聚合，避免全量加载物品内存计算。"""
    uid = user.id
    total = db.query(func.count(Item.id)).filter(Item.owner_id == uid).scalar() or 0
    by_status = {
        (s.value if hasattr(s, "value") else str(s)): c
        for s, c in db.query(Item.status, func.count(Item.id))
        .filter(Item.owner_id == uid)
        .group_by(Item.status)
        .all()
    }
    # price 为 NULL 时自然不计；price=0 正常计入
    total_value = (
        db.query(func.coalesce(func.sum(Item.price * Item.quantity), 0.0))
        .filter(Item.owner_id == uid)
        .scalar()
        or 0.0
    )
    cat_map = {
        c.id: c.name
        for c in db.query(Category).filter(Category.owner_id == uid).all()
    }
    cat_value_rows = (
        db.query(
            func.coalesce(Item.category_id, 0),
            func.coalesce(func.sum(Item.price * Item.quantity), 0.0),
        )
        .filter(Item.owner_id == uid)
        .group_by(func.coalesce(Item.category_id, 0))
        .all()
    )
    by_category_value = {
        (cat_map.get(cid, "未分类") if cid else "未分类"): float(v)
        for cid, v in cat_value_rows
    }
    return {
        "total": total,
        "by_status": by_status,
        "total_value": round(total_value, 2),
        "by_category_value": {
            k: round(v, 2)
            for k, v in sorted(by_category_value.items(), key=lambda x: -x[1])
        },
    }


def get_expiring(db: Session, user: User, days: int = 30) -> dict:
    """临期物品 + 保修到期列表。

    - 排除已归档与已处理终态（已清理/已丢弃）
    - 每条返回 days_left（负数=已过期）与 expired 标记，前端分段展示
    """
    today = date.today()
    threshold = today + timedelta(days=days)
    items = (
        db.query(Item)
        .filter(
            Item.owner_id == user.id,
            Item.archived == False,  # noqa: E712
            Item.status.notin_(["已清理", "已丢弃"]),
            Item.expiry_date.isnot(None),
            Item.expiry_date <= threshold,
        )
        .order_by(Item.expiry_date)
        .all()
    )
    warranty = (
        db.query(Item)
        .filter(
            Item.owner_id == user.id,
            Item.archived == False,  # noqa: E712
            Item.status.notin_(["已清理", "已丢弃"]),
            Item.warranty_expiry.isnot(None),
            Item.warranty_expiry <= threshold,
        )
        .order_by(Item.warranty_expiry)
        .all()
    )

    def _serialize(it: Item, date_attr: str) -> dict:
        d = getattr(it, date_attr)
        return {
            "id": it.id,
            "name": it.name,
            "expiry_date": d.isoformat() if d else None,
            "days_left": (d - today).days if d else None,
            "expired": d is not None and d < today,
            "location_id": it.location_id,
            "quantity": it.quantity,
            "unit": it.unit,
            "status": it.status.value if hasattr(it.status, "value") else str(it.status),
        }

    return {
        "expiring": [_serialize(it, "expiry_date") for it in items],
        "warranty_expiring": [_serialize(it, "warranty_expiry") for it in warranty],
    }
