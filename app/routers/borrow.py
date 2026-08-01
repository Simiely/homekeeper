"""借用记录：借出/归还/列表。"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.borrow import BorrowRecord
from app.models.item import Item
from app.models.user import User
from app.schemas.borrow import BorrowCreate, BorrowOut, BorrowUpdate

router = APIRouter(tags=["borrow"])


@router.get("/api/items/{item_id}/borrows", response_model=list[BorrowOut])
def list_borrows(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id, Item.owner_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    return (
        db.query(BorrowRecord)
        .filter(BorrowRecord.item_id == item_id)
        .order_by(BorrowRecord.created_at.desc())
        .all()
    )


@router.post("/api/items/{item_id}/borrows", response_model=BorrowOut, status_code=status.HTTP_201_CREATED)
def create_borrow(
    item_id: int,
    payload: BorrowCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id, Item.owner_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    record = BorrowRecord(
        item_id=item_id,
        borrower_name=payload.borrower_name,
        borrow_date=payload.borrow_date,
        expected_return_date=payload.expected_return_date,
        notes=payload.notes,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.put("/api/items/{item_id}/borrows/{borrow_id}", response_model=BorrowOut)
def update_borrow(
    item_id: int,
    borrow_id: int,
    payload: BorrowUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id, Item.owner_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    record = db.query(BorrowRecord).filter(BorrowRecord.id == borrow_id, BorrowRecord.item_id == item_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="借用记录不存在")
    if payload.return_date is not None:
        record.return_date = payload.return_date
    if payload.notes is not None:
        record.notes = payload.notes
    db.commit()
    db.refresh(record)
    return record


@router.delete("/api/items/{item_id}/borrows/{borrow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_borrow(
    item_id: int,
    borrow_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id, Item.owner_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    record = db.query(BorrowRecord).filter(BorrowRecord.id == borrow_id, BorrowRecord.item_id == item_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="借用记录不存在")
    db.delete(record)
    db.commit()
    return None
