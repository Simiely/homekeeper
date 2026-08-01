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
            func.sum(Item.price * Item.quantity),
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
    """临期物品 + 保修到期列表。"""
    today = date.today()
    threshold = today + timedelta(days=days)
    items = (
        db.query(Item)
        .filter(
            Item.owner_id == user.id,
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
            Item.warranty_expiry.isnot(None),
            Item.warranty_expiry <= threshold,
        )
        .order_by(Item.warranty_expiry)
        .all()
    )
    return {
        "expiring": [
            {
                "id": it.id,
                "name": it.name,
                "expiry_date": it.expiry_date.isoformat() if it.expiry_date else None,
            }
            for it in items
        ],
        "warranty_expiring": [
            {
                "id": it.id,
                "name": it.name,
                "serial_number": it.serial_number,
                "warranty_expiry": it.warranty_expiry.isoformat() if it.warranty_expiry else None,
            }
            for it in warranty
        ],
    }
