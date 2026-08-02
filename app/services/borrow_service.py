"""借用记录业务逻辑：物品归属校验 + 借用 CRUD（router 层只做 HTTP 编排）。"""
from sqlalchemy.orm import Session

from app.models.borrow import BorrowRecord
from app.models.item import Item
from app.models.user import User
from app.schemas.borrow import BorrowCreate, BorrowUpdate
from app.services.item_service import ItemNotFoundError


class BorrowNotFoundError(Exception):
    """借用记录不存在。"""


def _get_owned_item(db: Session, user: User, item_id: int) -> Item:
    item = db.query(Item).filter(Item.id == item_id, Item.owner_id == user.id).first()
    if not item:
        raise ItemNotFoundError(item_id)
    return item


def _get_owned_borrow(db: Session, user: User, item_id: int, borrow_id: int) -> BorrowRecord:
    _get_owned_item(db, user, item_id)  # 物品归属校验（不存在抛 ItemNotFoundError）
    record = (
        db.query(BorrowRecord)
        .filter(BorrowRecord.id == borrow_id, BorrowRecord.item_id == item_id)
        .first()
    )
    if not record:
        raise BorrowNotFoundError(borrow_id)
    return record


def list_borrows(db: Session, user: User, item_id: int) -> list[BorrowRecord]:
    _get_owned_item(db, user, item_id)
    return (
        db.query(BorrowRecord)
        .filter(BorrowRecord.item_id == item_id)
        .order_by(BorrowRecord.created_at.desc())
        .all()
    )


def create_borrow(db: Session, user: User, item_id: int, payload: BorrowCreate) -> BorrowRecord:
    _get_owned_item(db, user, item_id)
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


def update_borrow(db: Session, user: User, item_id: int, borrow_id: int, payload: BorrowUpdate) -> BorrowRecord:
    record = _get_owned_borrow(db, user, item_id, borrow_id)
    if payload.return_date is not None:
        record.return_date = payload.return_date
    if payload.notes is not None:
        record.notes = payload.notes
    db.commit()
    db.refresh(record)
    return record


def delete_borrow(db: Session, user: User, item_id: int, borrow_id: int) -> None:
    record = _get_owned_borrow(db, user, item_id, borrow_id)
    db.delete(record)
    db.commit()
