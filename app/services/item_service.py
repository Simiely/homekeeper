"""物品业务逻辑：CRUD / 筛选 / 分页 / 批量 / 二维码 / 日志 / 磁盘图片清理。"""
import io
import logging
from math import ceil
from pathlib import Path

import qrcode
from sqlalchemy import or_
from sqlalchemy.orm import Session, aliased

from app.config import DATA_DIR, settings
from app.models.category import Category
from app.models.item import Item
from app.models.item_log import ItemLog
from app.models.item_tag import item_tag_assoc
from app.models.location import Location
from app.models.status import ItemStatus
from app.models.tag import Tag
from app.models.user import User
from app.schemas.item import BatchAction, ItemCreate, ItemUpdate, PaginatedItems
# TagNotFoundError 统一由 tag_service 定义（main.py 全局处理器注册该类）
from app.services.tag_service import TagNotFoundError

logger = logging.getLogger("homekeeper.item")


class ItemNotFoundError(Exception):
    """物品不存在（或不属于当前用户）。"""


def get_owned_item(db: Session, user: User, item_id: int) -> Item:
    """按 id + 归属查询物品，不存在抛 ItemNotFoundError。"""
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == user.id)
        .first()
    )
    if not item:
        raise ItemNotFoundError(item_id)
    return item


def list_items(
    db: Session,
    user: User,
    *,
    keyword: str | None = None,
    barcode: str | None = None,
    status_filter: ItemStatus | None = None,
    category_id: int | None = None,
    location_id: int | None = None,
    tag_id: int | None = None,
    show_archived: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> PaginatedItems:
    q = db.query(Item).filter(Item.owner_id == user.id)
    if barcode:
        # 条形码精确匹配（扫码查重）
        q = q.filter(Item.barcode == barcode)
    elif keyword:
        # 关键词命中：物品自身字段 + 位置名 + 分类名 + 标签名（join 关联表）
        loc_alias = aliased(Location)
        cat_alias = aliased(Category)
        tag_alias = aliased(Tag)
        assoc_alias = item_tag_assoc.alias("kw_assoc")
        q = (
            q.outerjoin(loc_alias, Item.location_id == loc_alias.id)
            .outerjoin(cat_alias, Item.category_id == cat_alias.id)
            .outerjoin(assoc_alias, assoc_alias.c.item_id == Item.id)
            .outerjoin(tag_alias, assoc_alias.c.tag_id == tag_alias.id)
            .filter(
                or_(
                    Item.name.contains(keyword),
                    Item.description.contains(keyword),
                    Item.location_note.contains(keyword),
                    Item.serial_number.contains(keyword),
                    Item.barcode.contains(keyword),
                    loc_alias.name.contains(keyword),
                    cat_alias.name.contains(keyword),
                    tag_alias.name.contains(keyword),
                )
            )
            .distinct()
        )
    if status_filter is not None:
        q = q.filter(Item.status == status_filter)
    if category_id is not None:
        q = q.filter(Item.category_id == category_id)
    if location_id is not None:
        q = q.filter(Item.location_id == location_id)
    if tag_id is not None:
        q = q.join(item_tag_assoc).filter(item_tag_assoc.c.tag_id == tag_id)
    if not show_archived:
        q = q.filter(Item.archived == False)  # noqa: E712
    total = q.count()
    items = (
        q.order_by(Item.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedItems(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 0,
    )


def create_item(db: Session, user: User, payload: ItemCreate) -> Item:
    item = Item(owner_id=user.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_item(db: Session, user: User, item_id: int, payload: ItemUpdate) -> Item:
    item = get_owned_item(db, user, item_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, user: User, item_id: int) -> None:
    item = get_owned_item(db, user, item_id)
    # 清理磁盘图片文件
    # [local-dev] 原仓库为 Path("/app/data/images")，Docker 内路径
    img_dir = DATA_DIR / "images" / str(item.id)
    _clean_image_dir(img_dir)
    db.delete(item)
    db.commit()


def set_archived(db: Session, user: User, item_id: int, archived: bool) -> Item:
    item = get_owned_item(db, user, item_id)
    item.archived = archived
    db.commit()
    db.refresh(item)
    return item


def get_item_qrcode_bytes(db: Session, user: User, item_id: int) -> bytes:
    """生成物品二维码 PNG 字节（供 router 以 Response 返回）。"""
    item = get_owned_item(db, user, item_id)
    base_url = settings.public_url.rstrip("/") if settings.public_url else ""
    if base_url:
        content = f"{base_url}/?item={item.id}"
    else:
        content = f"拾光集 #{item.id}: {item.name}"
    img = qrcode.make(content)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


def get_item_logs(db: Session, user: User, item_id: int, limit: int = 50) -> list[dict]:
    get_owned_item(db, user, item_id)
    logs = (
        db.query(ItemLog)
        .filter(ItemLog.item_id == item_id)
        .order_by(ItemLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "action": log.action,
            "summary": log.summary,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


def batch_action(db: Session, user: User, payload: BatchAction) -> dict:
    """批量操作：删除/归档/更新。删除时同步清理磁盘图片（与单删一致）。"""
    uid = user.id
    items = (
        db.query(Item)
        .filter(Item.id.in_(payload.item_ids), Item.owner_id == uid)
        .all()
    )
    if not items:
        raise ItemNotFoundError(0)

    count = 0
    for item in items:
        if payload.action == "delete":
            img_dir = DATA_DIR / "images" / str(item.id)
            _clean_image_dir(img_dir)
            db.delete(item)
        elif payload.action == "archive":
            item.archived = True
        elif payload.action == "unarchive":
            item.archived = False
        elif payload.action == "update":
            if payload.status is not None:
                item.status = payload.status
            if payload.category_id is not None:
                item.category_id = payload.category_id
            if payload.location_id is not None:
                item.location_id = payload.location_id
        count += 1
    db.commit()

    return {"ok": True, "action": payload.action, "affected": count}


def add_tag_to_item(db: Session, user: User, item_id: int, tag_id: int) -> None:
    item = get_owned_item(db, user, item_id)
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == user.id)
        .first()
    )
    if not tag:
        raise TagNotFoundError(tag_id)
    if tag not in item.tags:
        item.tags.append(tag)
        db.commit()


def remove_tag_from_item(db: Session, user: User, item_id: int, tag_id: int) -> None:
    item = get_owned_item(db, user, item_id)
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == user.id)
        .first()
    )
    if not tag:
        raise TagNotFoundError(tag_id)
    item.tags.remove(tag)
    db.commit()


def _clean_image_dir(img_dir: Path) -> None:
    """删除物品图片目录（存在则清空并移除）。

    图片清理失败（如沙箱/权限拦截 unlink）不阻断物品删除——只记录告警，
    遗留的孤儿图片文件可由后续清理任务回收，避免删除物品整体失败。
    """
    if not img_dir.exists():
        return
    removed = 0
    for f in img_dir.iterdir():
        try:
            f.unlink()
            removed += 1
        except OSError as e:
            logger.warning("清理物品图片失败，跳过：%s（%s）", f, e)
    try:
        img_dir.rmdir()
    except OSError as e:
        logger.warning("移除图片目录失败，跳过：%s（%s）", img_dir, e)
