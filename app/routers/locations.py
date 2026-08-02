"""位置 CRUD（层级树）。删除父级时，子位置自动提升一级。业务在 services/location_service.py。"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.location import (
    LocationCreate,
    LocationOut,
    LocationReorderItem,
    LocationTreeNode,
    LocationUpdate,
)
from app.services import location_service

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return location_service.list_locations(db, current_user)


@router.put("/reorder")
def reorder_locations(
    payload: list[LocationReorderItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """拖拽排序后批量保存：仅更新 parent_id 与同级 sort_order。"""
    updated = location_service.reorder_locations(db, current_user, payload)
    return {"ok": True, "updated": updated}


@router.get("/tree", response_model=list[LocationTreeNode])
def list_location_tree(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """返回按 parent_id 组装的层级树。"""
    return location_service.build_location_tree(db, current_user)


@router.get("/{loc_id}", response_model=LocationOut)
def get_location(
    loc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return location_service.get_owned_location(db, current_user, loc_id)


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return location_service.create_location(db, current_user, payload)


@router.put("/{loc_id}", response_model=LocationOut)
def update_location(
    loc_id: int,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return location_service.update_location(db, current_user, loc_id, payload)


@router.delete("/{loc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    loc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    location_service.delete_location(db, current_user, loc_id)
