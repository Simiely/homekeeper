"""管理员用户管理 API（业务逻辑在 services/user_service.py，异常由全局处理器转 HTTP）。"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_admin_user
from app.models.user import User
from app.schemas.user import UserCreate, UserOut
from app.services import user_service

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def list_users(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """获取所有用户列表（仅管理员）。"""
    return user_service.list_users(db)


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """管理员创建新用户。"""
    return user_service.create_user(db, payload)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """管理员删除用户（不能删除自己，资源转交管理员）。"""
    user_service.delete_user(db, admin, user_id)
