"""标签业务逻辑：owner 校验 + CRUD（router 层只做 HTTP 编排）。"""
from sqlalchemy.orm import Session

from app.models.tag import Tag
from app.models.user import User
from app.schemas.tag import TagCreate, TagUpdate


class TagNotFoundError(Exception):
    """标签不存在（或不属于当前用户）。"""


def _get_owned(db: Session, user: User, tag_id: int) -> Tag:
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == user.id)
        .first()
    )
    if not tag:
        raise TagNotFoundError(tag_id)
    return tag


def list_tags(db: Session, user: User) -> list[Tag]:
    return (
        db.query(Tag)
        .filter(Tag.owner_id == user.id)
        .order_by(Tag.name)
        .all()
    )


def get_tag(db: Session, user: User, tag_id: int) -> Tag:
    return _get_owned(db, user, tag_id)


def create_tag(db: Session, user: User, payload: TagCreate) -> Tag:
    tag = Tag(owner_id=user.id, **payload.model_dump())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def update_tag(db: Session, user: User, tag_id: int, payload: TagUpdate) -> Tag:
    tag = _get_owned(db, user, tag_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tag, key, value)
    db.commit()
    db.refresh(tag)
    return tag


def delete_tag(db: Session, user: User, tag_id: int) -> None:
    tag = _get_owned(db, user, tag_id)
    db.delete(tag)
    db.commit()
