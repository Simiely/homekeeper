"""物品相关 Schema。"""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.status import ItemStatus
from app.schemas.tag import TagBrief


class ItemBase(BaseModel):
    name: str
    description: str = ""
    location_id: int | None = None
    location_note: str = ""
    category_id: int | None = None
    quantity: float = 1
    unit: str = "个"
    status: ItemStatus = ItemStatus.IN_STOCK
    expiry_date: date | None = None
    purchase_date: date | None = None
    serial_number: str | None = None
    warranty_expiry: date | None = None


class ItemCreate(ItemBase):
    archived: bool = False


class ItemUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    location_id: int | None = None
    location_note: str | None = None
    category_id: int | None = None
    quantity: float | None = None
    unit: str | None = None
    status: ItemStatus | None = None
    expiry_date: date | None = None
    purchase_date: date | None = None
    serial_number: str | None = None
    warranty_expiry: date | None = None
    archived: bool | None = None


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime | None = None
    tags: list[TagBrief] = []
    archived: bool = False


class PaginatedItems(BaseModel):
    items: list[ItemOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class BatchAction(BaseModel):
    item_ids: list[int]
    action: str  # "delete" | "archive" | "unarchive" | "update"
    status: ItemStatus | None = None
    category_id: int | None = None
    location_id: int | None = None
