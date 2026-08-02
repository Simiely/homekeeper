"""仪表盘统计业务：SQL 聚合概览 + 即将过期/保修到期提醒。"""
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.item import Item
from app.models.status import status_value
from app.models.user import User
from app.services.expiry_query import get_expiring_items


def get_summary(db: Session, user: User) -> dict:
    """统计概览：全部改为 SQL 聚合，避免全量加载物品内存计算。"""
    uid = user.id
    total = db.query(func.count(Item.id)).filter(Item.owner_id == uid).scalar() or 0
    by_status = {
        status_value(s): c
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
    """临期物品 + 保修到期列表（共用 expiry_query，与推送扫描同一套过滤）。

    - 排除已归档与已处理终态（已清理/已丢弃）
    - 每条返回 days_left（负数=已过期）与 expired 标记，前端分段展示
    """
    today = date.today()
    items, warranty = get_expiring_items(db, user, days, include_expired=True)

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
            "status": status_value(it.status),
        }

    return {
        "expiring": [_serialize(it, "expiry_date") for it in items],
        "warranty_expiring": [_serialize(it, "warranty_expiry") for it in warranty],
    }
