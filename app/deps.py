"""依赖注入：数据库会话与当前登录用户。"""
from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import verify_token
from app.database import get_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _resolve_token(authorization: str | None, query_token: str | None) -> str | None:
    """兼容两种凭证来源：Authorization header 或 ?token= query（<img> 等无法带 header 的场景）。"""
    if query_token:
        return query_token
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    return None


def _authenticate(raw_token: str | None, db: Session) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效或过期的凭证",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not raw_token:
        raise credentials_exc
    username = verify_token(raw_token, credentials_exc)
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exc
    return user


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    return _authenticate(token, db)


def get_current_user_flex(
    authorization: str | None = Header(None),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
) -> User:
    """用于 <img>/<a> 等无法携带 header 的资源端点：支持 header 或 query token。"""
    return _authenticate(_resolve_token(authorization, token), db)


def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """仅允许管理员访问。"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可执行此操作",
        )
    return current_user
