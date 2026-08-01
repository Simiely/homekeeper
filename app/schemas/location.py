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


class LocationReorderItem(BaseModel):
    """拖拽排序的单个节点：仅变更 parent_id 与同级 sort_order。"""

    id: int
    parent_id: int | None = None
    sort_order: int = 0


class LocationOut(LocationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sort_order: int = 0
    owner_id: int
    created_at: datetime


class LocationTreeNode(BaseModel):
    """递归树节点，用于 GET /api/locations/tree。"""

    id: int
    name: str
    parent_id: int | None
    note: str
    children: list["LocationTreeNode"] = []
