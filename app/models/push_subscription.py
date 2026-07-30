"""Web Push 订阅模型。存储浏览器推送端点信息。"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    endpoint: Mapped[str] = mapped_column(Text)  # 推送端点 URL
    auth_key: Mapped[str] = mapped_column(String(64))  # 客户端 auth 密钥
    p256dh_key: Mapped[str] = mapped_column(String(128))  # 客户端 p256dh 公钥
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
