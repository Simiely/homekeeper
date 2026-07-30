"""多对多关联表：Item ↔ Tag。"""
from sqlalchemy import Column, ForeignKey, Integer, Table

from app.database import Base

item_tag_assoc = Table(
    "item_tags",
    Base.metadata,
    Column("item_id", Integer, ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)
