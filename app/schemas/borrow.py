"""借用记录 Schema。"""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class BorrowCreate(BaseModel):
    borrower_name: str
    borrow_date: date  # YYYY-MM-DD（Pydantic 自动校验，非法输入返回 422）
    expected_return_date: date | None = None
    notes: str = ""


class BorrowUpdate(BaseModel):
    return_date: date | None = None
    notes: str | None = None


class BorrowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    borrower_name: str
    borrow_date: date
    expected_return_date: date | None = None
    return_date: date | None = None
    notes: str
    created_at: datetime
