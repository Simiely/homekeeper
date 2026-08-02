"""借用记录 API（业务逻辑在 services/borrow_service.py，异常由全局处理器转 HTTP）。"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.borrow import BorrowCreate, BorrowOut, BorrowUpdate
from app.services import borrow_service

router = APIRouter(tags=["borrow"])


@router.get("/api/items/{item_id}/borrows", response_model=list[BorrowOut])
def list_borrows(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return borrow_service.list_borrows(db, current_user, item_id)


@router.post("/api/items/{item_id}/borrows", response_model=BorrowOut, status_code=status.HTTP_201_CREATED)
def create_borrow(
    item_id: int,
    payload: BorrowCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return borrow_service.create_borrow(db, current_user, item_id, payload)


@router.put("/api/items/{item_id}/borrows/{borrow_id}", response_model=BorrowOut)
def update_borrow(
    item_id: int,
    borrow_id: int,
    payload: BorrowUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return borrow_service.update_borrow(db, current_user, item_id, borrow_id, payload)


@router.delete("/api/items/{item_id}/borrows/{borrow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_borrow(
    item_id: int,
    borrow_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    borrow_service.delete_borrow(db, current_user, item_id, borrow_id)
