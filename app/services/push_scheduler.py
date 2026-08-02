"""Web Push 业务与调度：VAPID 密钥管理 + 定时扫描过期物品 + 推送发送。

职责边界：本模块只做业务与调度，不定义任何 API 路由；
HTTP 端点见 routers/push.py，调度器的统一启停见 services/scheduler.py。
"""
import json
import logging
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import date, timedelta
from urllib.parse import urlparse

from apscheduler.schedulers.background import BackgroundScheduler
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import webpush
from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.database import SessionLocal
from app.models.item import Item
from app.models.push_subscription import PushSubscription
from app.models.user import User

logger = logging.getLogger("homekeeper.push")

# 扫描配置
EXPIRY_WARN_DAYS = 3  # 提前几天提醒
SCAN_INTERVAL_HOURS = 6  # 扫描间隔

# VAPID 密钥文件（存放在持久卷 data/ 下）
# [local-dev] 原仓库为 Path("/app/data/vapid.json")，Docker 内路径
VAPID_FILE = DATA_DIR / "vapid.json"


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


def get_vapid() -> Vapid | None:
    """全局缓存的 VAPID 实例。"""
    if not hasattr(get_vapid, "_instance"):
        get_vapid._instance = _load_or_create_vapid()
    return get_vapid._instance


# ========== 调度器 ==========

scheduler = BackgroundScheduler()


def start_scheduler():
    """注册并启动过期扫描任务（由 services/scheduler.py 统一调用）。"""
    get_vapid()  # 预热加载 VAPID 密钥
    if scheduler.get_job("expiry_check"):
        return
    scheduler.add_job(
        _check_all_users,
        "interval",
        hours=SCAN_INTERVAL_HOURS,
        id="expiry_check",
    )
    scheduler.start()
    logger.info("推送调度器已启动（每 %s 小时扫描）", SCAN_INTERVAL_HOURS)


def stop_scheduler():
    """停止过期扫描任务（由 services/scheduler.py 统一调用）。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("推送调度器已停止")


def _check_all_users():
    """遍历所有用户，检查即将过期的物品并推送。"""
    v = get_vapid()
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
                    Item.archived == False,  # noqa: E712
                    Item.expiry_date.isnot(None),
                    Item.expiry_date <= warn_date,
                    Item.expiry_date >= today,
                )
                .order_by(Item.expiry_date)
                .all()
            )
            warranty = (
                db.query(Item)
                .filter(
                    Item.owner_id == user.id,
                    Item.archived == False,  # noqa: E712
                    Item.warranty_expiry.isnot(None),
                    Item.warranty_expiry <= warn_date,
                    Item.warranty_expiry >= today,
                )
                .order_by(Item.warranty_expiry)
                .all()
            )
            if not expiring and not warranty:
                continue

            parts = [f"{it.name}（{(it.expiry_date - today).days}天）" for it in expiring[:5]]
            parts += [
                f"{it.name} 保修（{(it.warranty_expiry - today).days}天）"
                for it in warranty[:3]
            ]
            total = len(expiring) + len(warranty)
            items_text = " · ".join(parts)
            if total > 8:
                items_text += f" · 还有{total - 8}件"

            payload = json.dumps(
                {
                    "title": "🏠 拾光集",
                    "body": f"{total} 件物品待处理：{items_text}",
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
