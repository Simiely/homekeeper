"""认证业务：登录校验 + 令牌签发。"""
from sqlalchemy.orm import Session

from app.core.security import create_access_token, verify_password
from app.models.user import User


class InvalidCredentialsError(Exception):
    """用户名或密码错误。"""


def authenticate(db: Session, username: str, password: str) -> str:
    """校验用户名密码，返回访问令牌。失败抛 InvalidCredentialsError。"""
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise InvalidCredentialsError("用户名或密码错误")
    return create_access_token(user.username)
