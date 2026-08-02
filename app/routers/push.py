"""Web Push API：订阅管理 + VAPID 公钥下发。

职责边界：本模块只定义 HTTP 端点；订阅业务见 services/push_scheduler.py 的 subscribe/unsubscribe。
"""
from base64 import urlsafe_b64encode

from cryptography.hazmat.primitives import serialization
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.push_subscription import SubscribeBody
from app.services import push_scheduler
from app.services.push_scheduler import get_vapid

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key")
def get_vapid_public_key():
    """返回 VAPID 公钥（base64url 编码，供浏览器 PushManager 使用）。"""
    v = get_vapid()
    if not v:
        raise HTTPException(status_code=503, detail="VAPID 密钥生成失败")
    # 浏览器需要 base64url 编码的原始公钥（不含 PEM 头尾）
    raw_pub = v.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    b64_pub = urlsafe_b64encode(raw_pub).rstrip(b"=").decode()
    return {"public_key": b64_pub}


@router.post("/subscribe", status_code=status.HTTP_201_CREATED)
def subscribe(
    body: SubscribeBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """保存浏览器的推送订阅信息（幂等 upsert）。"""
    push_scheduler.subscribe(db, current_user, body)
    return {"ok": True}


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    body: SubscribeBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除推送订阅（用户取消授权时调用）。"""
    push_scheduler.unsubscribe(db, current_user, body)
    return None
