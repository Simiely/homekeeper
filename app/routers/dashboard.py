"""仪表盘：统计概览与即将过期提醒。"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.category import Category
from app.models.item import Item
from app.models.user import User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = db.query(Item).filter(Item.owner_id == current_user.id).all()
    by_status: dict[str, int] = {}
    total_value = 0.0
    by_category_value: dict[str, float] = {}
    cat_map = {c.id: c.name for c in db.query(Category).filter(Category.owner_id == current_user.id).all()}
    for it in items:
        key = it.status.value if hasattr(it.status, "value") else str(it.status)
        by_status[key] = by_status.get(key, 0) + 1
        if it.price:
            total_value += it.price * it.quantity
            cat_name = cat_map.get(it.category_id, "未分类")
            by_category_value[cat_name] = by_category_value.get(cat_name, 0) + it.price * it.quantity
    return {
        "total": len(items),
        "by_status": by_status,
        "total_value": round(total_value, 2),
        "by_category_value": {k: round(v, 2) for k, v in sorted(by_category_value.items(), key=lambda x: -x[1])},
    }


@router.get("/expiring")
def expiring(
    days: int = Query(30, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    threshold = today + timedelta(days=days)
    items = (
        db.query(Item)
        .filter(
            Item.owner_id == current_user.id,
            Item.expiry_date.isnot(None),
            Item.expiry_date <= threshold,
        )
        .order_by(Item.expiry_date)
        .all()
    )
    warranty = (
        db.query(Item)
        .filter(
            Item.owner_id == current_user.id,
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
