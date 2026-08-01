"""仪表盘：统计概览与即将过期提醒。业务在 services/dashboard_service.py。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services import dashboard_service

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """统计概览。"""
    return dashboard_service.get_summary(db, current_user)


@router.get("/expiring")
def expiring(
    days: int = Query(30, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return dashboard_service.get_expiring(db, current_user, days)
