"""仪表盘：统计概览与即将过期提醒。"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
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
    for it in items:
        key = it.status.value if hasattr(it.status, "value") else str(it.status)
        by_status[key] = by_status.get(key, 0) + 1
    return {"total": len(items), "by_status": by_status}


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
    return [
        {
            "id": it.id,
            "name": it.name,
            "expiry_date": it.expiry_date.isoformat() if it.expiry_date else None,
        }
        for it in items
    ]
