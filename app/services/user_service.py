"""用户管理业务逻辑（仅管理员）：列表 / 创建 / 删除（资源转交）。"""
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.category import Category
from app.models.item import Item
from app.models.location import Location
from app.models.tag import Tag
from app.models.user import User
from app.schemas.user import UserCreate


class UserNotFoundError(Exception):
    """用户不存在。"""


class UsernameExistsError(Exception):
    """用户名已存在。"""


class CannotDeleteSelfError(Exception):
    """不能删除自己。"""


def list_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at.desc()).all()


def create_user(db: Session, payload: UserCreate) -> User:
    exists = db.query(User).filter(User.username == payload.username).first()
    if exists:
        raise UsernameExistsError(payload.username)
    user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, admin: User, user_id: int) -> None:
    """删除用户（不能删除自己）。

    用户名下资源（物品/分类/位置/标签）转交给执行删除的管理员，避免外键约束报错且数据不丢失；
    推送订阅随用户级联删除，操作日志保留（user_id 置空）。
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise UserNotFoundError(user_id)
    if user.id == admin.id:
        raise CannotDeleteSelfError()
    # 转交资源给当前管理员
    for model in (Item, Category, Location, Tag):
        db.query(model).filter(model.owner_id == user.id).update({model.owner_id: admin.id})
    db.delete(user)
    db.commit()
