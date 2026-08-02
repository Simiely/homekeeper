"""临期物品查询——dashboard 首页与推送扫描共用，避免两处过滤逻辑漂移。

差异参数化：
- include_expired：True=包含已过期（dashboard 分段展示）；False=仅未来（推送只提醒未过期）
- exclude_terminal：排除已清理/已丢弃终态（标记过的不再提醒）
"""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.status import ItemStatus
from app.models.user import User

# 处理终态：标记后不再出现在任何临期提醒中
TERMINAL_STATUSES = [ItemStatus.CLEANED.value, ItemStatus.DISCARDED.value]


def get_expiring_items(
    db: Session,
    user: User,
    days: int,
    include_expired: bool = True,
    exclude_terminal: bool = True,
) -> tuple[list[Item], list[Item]]:
    """返回 (expiry 临期物品, warranty 临期物品)，各自按日期升序。"""
    today = date.today()
    threshold = today + timedelta(days=days)
    base = [
        Item.owner_id == user.id,
        Item.archived == False,  # noqa: E712
    ]
    if exclude_terminal:
        base.append(Item.status.notin_(TERMINAL_STATUSES))

    expiring = (
        db.query(Item)
        .filter(
            *base,
            Item.expiry_date.isnot(None),
            Item.expiry_date <= threshold,
        )
        .order_by(Item.expiry_date)
        .all()
    )
    warranty = (
        db.query(Item)
        .filter(
            *base,
            Item.warranty_expiry.isnot(None),
            Item.warranty_expiry <= threshold,
        )
        .order_by(Item.warranty_expiry)
        .all()
    )
    if not include_expired:
        expiring = [it for it in expiring if it.expiry_date >= today]
        warranty = [it for it in warranty if it.warranty_expiry >= today]
    return expiring, warranty
