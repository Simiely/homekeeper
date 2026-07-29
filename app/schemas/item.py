"""物品相关 Schema。"""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.status import ItemStatus


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


class ItemCreate(ItemBase):
    pass


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


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime | None = None
