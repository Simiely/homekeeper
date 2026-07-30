"""统一导出所有模型，确保 Base.metadata 注册。"""
from app.models.borrow import BorrowRecord
from app.models.category import Category
from app.models.item import Item
from app.models.item_image import ItemImage
from app.models.item_log import ItemLog
from app.models.location import Location
from app.models.push_subscription import PushSubscription
from app.models.status import ItemStatus
from app.models.tag import Tag
from app.models.user import User

__all__ = [
    "User",
    "Location",
    "Category",
    "Item",
    "BorrowRecord",
    "ItemImage",
    "ItemLog",
    "Tag",
    "PushSubscription",
    "ItemStatus",
]
