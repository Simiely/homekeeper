"""Web Push：订阅管理 + 定时扫描过期物品 + 推送发送。"""
import json
import logging
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, Depends, HTTPException, status
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import webpush
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models.item import Item
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.schemas.push_subscription import SubscribeBody

logger = logging.getLogger("homekeeper.push")
router = APIRouter(prefix="/api/push", tags=["push"])

# 扫描配置
EXPIRY_WARN_DAYS = 3  # 提前几天提醒
SCAN_INTERVAL_HOURS = 6  # 扫描间隔

# VAPID 密钥文件（存放在 Docker 持久卷 data/ 下）
VAPID_FILE = Path("/app/data/vapid.json")


# ========== VAPID 密钥管理 ==========


def _load_or_create_vapid() -> Vapid | None:
    """从 JSON 文件加载 VAPID 密钥，不存在则自动生成。"""
    if VAPID_FILE.exists():
        try:
            data = json.loads(VAPID_FILE.read_text())
            v = Vapid.from_raw(data["private_key_b64"])
            logger.info("VAPID 密钥已从 %s 加载", VAPID_FILE)
            return v
        except Exception:
            logger.warning("VAPID 密钥文件损坏，重新生成")
    # 生成新密钥
    v = Vapid()
    v.generate_keys()
    # 导出 raw 32-byte 私钥
    raw_priv = v.private_key.private_numbers().private_value.to_bytes(32, "big")
    b64_priv = urlsafe_b64encode(raw_priv).rstrip(b"=").decode()
    try:
        VAPID_FILE.parent.mkdir(parents=True, exist_ok=True)
        VAPID_FILE.write_text(json.dumps({"private_key_b64": b64_priv}))
        logger.info("VAPID 密钥已生成并保存至 %s", VAPID_FILE)
    except Exception:
        logger.warning("VAPID 密钥无法写入 %s", VAPID_FILE)
    return v


def _get_vapid() -> Vapid | None:
    """全局缓存的 VAPID 实例。"""
    if not hasattr(_get_vapid, "_instance"):
        _get_vapid._instance = _load_or_create_vapid()
    return _get_vapid._instance


# ========== API 端点 ==========


@router.get("/vapid-public-key")
def get_vapid_public_key():
    """返回 VAPID 公钥（base64url 编码，供浏览器 PushManager 使用）。"""
    v = _get_vapid()
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
    """保存浏览器的推送订阅信息。"""
    existing = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == current_user.id,
            PushSubscription.endpoint == body.endpoint,
        )
        .first()
    )
    if existing:
        existing.auth_key = body.auth_key
        existing.p256dh_key = body.p256dh_key
    else:
        sub = PushSubscription(
            user_id=current_user.id,
            endpoint=body.endpoint,
            auth_key=body.auth_key,
            p256dh_key=body.p256dh_key,
        )
        db.add(sub)
    db.commit()
    return {"ok": True}


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    body: SubscribeBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除推送订阅（用户取消授权时调用）。"""
    db.query(PushSubscription).filter(
        PushSubscription.user_id == current_user.id,
        PushSubscription.endpoint == body.endpoint,
    ).delete()
    db.commit()
    return None


# ========== 调度器 ==========

scheduler = BackgroundScheduler()


def start_scheduler():
    """在 FastAPI lifespan 中调用。"""
    # 预热加载 VAPID 密钥
    _get_vapid()
    if scheduler.get_job("expiry_check"):
        return
    scheduler.add_job(
        _check_all_users,
        "interval",
        hours=SCAN_INTERVAL_HOURS,
        id="expiry_check",
        next_run_time=None,
    )
    scheduler.start()
    logger.info("推送调度器已启动（每 %s 小时扫描）", SCAN_INTERVAL_HOURS)


def stop_scheduler():
    """在 FastAPI lifespan 结束时调用。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("推送调度器已停止")


def _check_all_users():
    """遍历所有用户，检查即将过期的物品并推送。"""
    v = _get_vapid()
    if not v:
        logger.warning("VAPID 未初始化，跳过推送扫描")
        return

    db = None
    try:
        db = SessionLocal()
        users = db.query(User).all()
        today = date.today()
        warn_date = today + timedelta(days=EXPIRY_WARN_DAYS)

        for user in users:
            expiring = (
                db.query(Item)
                .filter(
                    Item.owner_id == user.id,
                    Item.expiry_date.isnot(None),
                    Item.expiry_date <= warn_date,
                    Item.expiry_date >= today,
                )
                .order_by(Item.expiry_date)
                .all()
            )
            if not expiring:
                continue

            items_text = " · ".join(
                f"{it.name}（{(it.expiry_date - today).days}天）"
                for it in expiring[:5]
            )
            if len(expiring) > 5:
                items_text += f" · 还有{len(expiring)-5}件"

            payload = json.dumps(
                {
                    "title": "📦 物管家",
                    "body": f"{len(expiring)} 件物品即将过期：{items_text}",
                }
            )

            subs = (
                db.query(PushSubscription)
                .filter(PushSubscription.user_id == user.id)
                .all()
            )
            for sub in subs:
                _send_push(v, sub, payload, db)
    except Exception:
        logger.exception("推送扫描异常")
    finally:
        if db is not None:
            db.close()


def _send_push(v: Vapid, sub: PushSubscription, payload: str, db: Session):
    """发送单条推送，失败时清理无效订阅。"""
    try:
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"auth": sub.auth_key, "p256dh": sub.p256dh_key},
            },
            data=payload,
            vapid_private_key=v,
            vapid_claims={
                "sub": f"mailto:admin@{urlparse(sub.endpoint).hostname or 'homekeeper'}"
            },
            ttl=86400,
        )
    except Exception as e:
        err_str = str(e)
        if "410" in err_str or "Gone" in err_str:
            logger.info("清理无效订阅 endpoint=%s...", sub.endpoint[:60])
            db.delete(sub)
            db.commit()
        else:
            logger.warning("推送失败 endpoint=%s: %s", sub.endpoint[:60], err_str[:100])
