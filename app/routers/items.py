"""物品 CRUD，按当前用户隔离；支持按关键词/状态/分类/位置筛选 + 分页。"""
import io
from math import ceil
from pathlib import Path

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models.item import Item
from app.models.item_image import ItemImage
from app.models.item_tag import item_tag_assoc
from app.models.status import ItemStatus
from app.models.tag import Tag
from app.models.user import User
from app.schemas.item import BatchAction, ItemCreate, ItemOut, ItemUpdate, PaginatedItems
from app.models.item_log import ItemLog

router = APIRouter(prefix="/api/items", tags=["items"])


def _log_item(item: Item, action: str, summary: str, db: Session):
    """写入操作日志。"""
    db.add(ItemLog(item_id=item.id, user_id=item.owner_id, action=action, summary=summary))


def _item_changes(item: Item, payload: ItemUpdate, old: dict) -> str:
    """比较旧值和 payload，返回变更摘要。"""
    parts = []
    for key, new_val in payload.model_dump(exclude_unset=True).items():
        old_val = old.get(key)
        if old_val != new_val:
            parts.append(f"{key}: {_v(old_val)} → {_v(new_val)}")
    return "；".join(parts) if parts else "无变更"


def _v(v):
    if v is None:
        return "空"
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@router.get("", response_model=PaginatedItems)
def list_items(
    keyword: str | None = None,
    status_filter: ItemStatus | None = None,
    category_id: int | None = None,
    location_id: int | None = None,
    tag_id: int | None = None,
    show_archived: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Item).filter(Item.owner_id == current_user.id)
    if keyword:
        q = q.filter(
            or_(
                Item.name.contains(keyword),
                Item.description.contains(keyword),
                Item.location_note.contains(keyword),
            )
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


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: ItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = Item(owner_id=current_user.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    _log_item(item, "create", f"创建物品「{item.name}」", db)
    db.commit()
    return item


@router.get("/{item_id}", response_model=ItemOut)
def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    return item


@router.put("/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    payload: ItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    # 记录变更前状态
    old = {key: getattr(item, key) for key in payload.model_dump(exclude_unset=True).keys()}
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    changes = _item_changes(item, payload, old)
    db.commit()
    db.refresh(item)
    _log_item(item, "update", f"更新物品「{item.name}」: {changes}", db)
    db.commit()
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    _log_item(item, "delete", f"删除物品「{item.name}」", db)
    # 清理磁盘图片文件
    img_dir = Path("/app/data/images") / str(item.id)
    if img_dir.exists():
        for f in img_dir.iterdir():
            f.unlink()
        img_dir.rmdir()
    db.delete(item)
    db.commit()


# ========== 归档 ==========


@router.post("/{item_id}/archive", response_model=ItemOut)
def archive_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    item.archived = True
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/unarchive", response_model=ItemOut)
def unarchive_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    item.archived = False
    db.commit()
    db.refresh(item)
    return item


# ========== QR 码 ==========


@router.get("/{item_id}/qrcode")
def get_item_qrcode(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """生成物品的二维码图片（PNG）。"""
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")

    # 拼接二维码内容
    base_url = settings.public_url.rstrip("/") if settings.public_url else ""
    if base_url:
        content = f"{base_url}/?item={item.id}"
    else:
        content = f"物管家 #{item.id}: {item.name}"

    img = qrcode.make(content)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="image/png")


# ========== 操作日志 ==========


@router.get("/{item_id}/logs")
def get_item_logs(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取物品的操作日志。"""
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    logs = (
        db.query(ItemLog)
        .filter(ItemLog.item_id == item_id)
        .order_by(ItemLog.created_at.desc())
        .limit(50)
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


# ========== 批量操作 ==========


@router.post("/batch")
def batch_action(
    payload: BatchAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批量操作：删除/归档/更新物品。"""
    uid = current_user.id
    items = (
        db.query(Item)
        .filter(Item.id.in_(payload.item_ids), Item.owner_id == uid)
        .all()
    )
    if not items:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到匹配物品")

    count = 0
    for item in items:
        if payload.action == "delete":
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


# ========== 物品-标签关联 ==========


@router.post("/{item_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_tag_to_item(
    item_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == current_user.id)
        .first()
    )
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="标签不存在")
    if tag not in item.tags:
        item.tags.append(tag)
        db.commit()
    return None


@router.delete("/{item_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag_from_item(
    item_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    tag = (
        db.query(Tag)
        .filter(Tag.id == tag_id, Tag.owner_id == current_user.id)
        .first()
    )
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="标签不存在")
    item.tags.remove(tag)
    db.commit()
    return None
