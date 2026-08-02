"""物品 CRUD，按当前用户隔离；支持筛选 + 分页（业务逻辑在 services/item_service.py）。

领域异常（ItemNotFoundError/TagNotFoundError）由 main.py 全局异常处理器统一转 HTTP 404，
router 层不再重复 try/except 映射。
"""
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_current_user_flex
from app.models.status import ItemStatus
from app.models.user import User
from app.schemas.item import BatchAction, ItemCreate, ItemOut, ItemUpdate, PaginatedItems
from app.services import item_service

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("", response_model=PaginatedItems)
def list_items(
    keyword: str | None = None,
    barcode: str | None = None,
    status_filter: ItemStatus | None = None,
    category_id: int | None = None,
    location_id: int | None = None,
    tag_id: int | None = None,
    tag_ids: list[int] | None = Query(None),
    show_archived: bool = Query(False),
    sort: str = Query("newest", pattern="^(newest|expiry|location|category)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return item_service.list_items(
        db,
        current_user,
        keyword=keyword,
        barcode=barcode,
        status_filter=status_filter,
        category_id=category_id,
        location_id=location_id,
        tag_id=tag_id,
        tag_ids=tag_ids,
        show_archived=show_archived,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: ItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return item_service.create_item(db, current_user, payload)


@router.get("/{item_id}", response_model=ItemOut)
def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return item_service.get_owned_item(db, current_user, item_id)


@router.put("/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    payload: ItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return item_service.update_item(db, current_user, item_id, payload)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item_service.delete_item(db, current_user, item_id)


# ========== 归档 ==========


@router.post("/{item_id}/archive", response_model=ItemOut)
def archive_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return item_service.set_archived(db, current_user, item_id, True)


@router.post("/{item_id}/unarchive", response_model=ItemOut)
def unarchive_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return item_service.set_archived(db, current_user, item_id, False)


# ========== QR 码 ==========


@router.get("/{item_id}/qrcode")
def get_item_qrcode(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flex),
):
    """生成物品的二维码图片（PNG）。支持 header 或 ?token= query（供 <img> 引用）。"""
    png = item_service.get_item_qrcode_bytes(db, current_user, item_id)
    return Response(content=png, media_type="image/png")


# ========== 操作日志 ==========


@router.get("/{item_id}/logs")
def get_item_logs(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取物品的操作日志。"""
    return item_service.get_item_logs(db, current_user, item_id)


# ========== 批量操作 ==========


@router.post("/batch")
def batch_action(
    payload: BatchAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批量操作：删除/归档/更新物品。"""
    return item_service.batch_action(db, current_user, payload)


# ========== 物品-标签关联 ==========


@router.post("/{item_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_tag_to_item(
    item_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item_service.add_tag_to_item(db, current_user, item_id, tag_id)
    return None


@router.delete("/{item_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag_from_item(
    item_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item_service.remove_tag_from_item(db, current_user, item_id, tag_id)
    return None
