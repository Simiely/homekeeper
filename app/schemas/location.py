"""位置相关 Schema。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LocationBase(BaseModel):
    name: str
    parent_id: int | None = None
    note: str = ""


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    note: str | None = None


class LocationOut(LocationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    created_at: datetime
