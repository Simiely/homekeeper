"""标签 Schema。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TagCreate(BaseModel):
    name: str
    color: str = "#FB7299"


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    owner_id: int
    created_at: datetime


class TagBrief(BaseModel):
    """物品列表中使用的标签简略信息。"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
