"""物品图片 Schema。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ItemImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    filename: str
    original_name: str
    width: int
    height: int
    file_size: int
    created_at: datetime
