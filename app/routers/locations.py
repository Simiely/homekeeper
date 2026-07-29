"""位置 CRUD（层级树）。删除父级时，子位置自动提升一级。"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.location import Location
from app.models.user import User
from app.schemas.location import LocationCreate, LocationOut, LocationUpdate

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Location)
        .filter(Location.owner_id == current_user.id)
        .order_by(Location.id)
        .all()
    )


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loc = Location(owner_id=current_user.id, **payload.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


@router.put("/{loc_id}", response_model=LocationOut)
def update_location(
    loc_id: int,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loc = (
        db.query(Location)
        .filter(Location.id == loc_id, Location.owner_id == current_user.id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="位置不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(loc, key, value)
    db.commit()
    db.refresh(loc)
    return loc


@router.delete("/{loc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    loc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loc = (
        db.query(Location)
        .filter(Location.id == loc_id, Location.owner_id == current_user.id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="位置不存在")
    # 子位置提升一级（挂到被删位置的父级）
    for child in db.query(Location).filter(Location.parent_id == loc_id).all():
        child.parent_id = loc.parent_id
    db.delete(loc)
    db.commit()
