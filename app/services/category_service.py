"""分类业务逻辑：owner 校验 + CRUD（router 层只做 HTTP 编排）。"""
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.user import User
from app.schemas.category import CategoryCreate, CategoryUpdate


class CategoryNotFoundError(Exception):
    """分类不存在（或不属于当前用户）。"""


def _get_owned(db: Session, user: User, cat_id: int) -> Category:
    cat = (
        db.query(Category)
        .filter(Category.id == cat_id, Category.owner_id == user.id)
        .first()
    )
    if not cat:
        raise CategoryNotFoundError(cat_id)
    return cat


def list_categories(db: Session, user: User) -> list[Category]:
    return (
        db.query(Category)
        .filter(Category.owner_id == user.id)
        .order_by(Category.id)
        .all()
    )


def get_category(db: Session, user: User, cat_id: int) -> Category:
    return _get_owned(db, user, cat_id)


def create_category(db: Session, user: User, payload: CategoryCreate) -> Category:
    cat = Category(owner_id=user.id, **payload.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def update_category(db: Session, user: User, cat_id: int, payload: CategoryUpdate) -> Category:
    cat = _get_owned(db, user, cat_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(cat, key, value)
    db.commit()
    db.refresh(cat)
    return cat


def delete_category(db: Session, user: User, cat_id: int) -> None:
    cat = _get_owned(db, user, cat_id)
    db.delete(cat)
    db.commit()
