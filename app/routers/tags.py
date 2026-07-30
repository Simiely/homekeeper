"""标签 CRUD。"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.tag import Tag
from app.models.user import User
from app.schemas.tag import TagCreate, TagOut, TagUpdate

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Tag)
        .filter(Tag.owner_id == current_user.id)
        .order_by(Tag.name)
        .all()
    )


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = Tag(owner_id=current_user.id, **payload.model_dump())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: int,
    payload: TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == current_user.id)
        .first()
    )
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="标签不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tag, key, value)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == current_user.id)
        .first()
    )
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="标签不存在")
    db.delete(tag)
    db.commit()
    return None
