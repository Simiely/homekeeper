"""物品模型：核心实体，关联位置 / 分类 / 用户。"""
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.item_tag import item_tag_assoc
from app.models.status import ItemStatus


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    location_id: Mapped[int | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    location_note: Mapped[str] = mapped_column(String(255), default="")  # 自由备注位置
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    quantity: Mapped[float] = mapped_column(default=1)
    unit: Mapped[str] = mapped_column(String(20), default="个")
    status: Mapped[ItemStatus] = mapped_column(default=ItemStatus.IN_STOCK)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    shelf_life_days: Mapped[int | None] = mapped_column(nullable=True)  # 保质期天数（选填，用于自动计算到期）
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)  # 条形码（扫码录入）
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )
    archived: Mapped[bool] = mapped_column(default=False)
    serial_number: Mapped[str | None] = mapped_column(String(200), default=None)
    warranty_expiry: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    price: Mapped[float | None] = mapped_column(default=None)

    tags: Mapped[list["Tag"]] = relationship(  # noqa: F821
        secondary=item_tag_assoc, back_populates="items", lazy="selectin"
    )
