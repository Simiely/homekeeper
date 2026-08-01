"""物品图片：上传 / 服务 / 删除。业务在 services/image_service.py。"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_current_user_flex
from app.models.user import User
from app.schemas.item_image import ItemImageOut
from app.services import image_service

router = APIRouter(tags=["images"])


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, image_service.ImageProcessError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="图片处理失败，请确认上传的是有效图片文件",
        )
    if isinstance(exc, image_service.ImageNotFoundError):
        detail = str(exc)
        if detail == "无效文件名":
            return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")


@router.post(
    "/api/items/{item_id}/images",
    response_model=ItemImageOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_image(
    item_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw = file.file.read()
    try:
        return image_service.upload_image(
            db, current_user, item_id, raw, file.filename
        )
    except (image_service.ImageNotFoundError, image_service.ImageProcessError) as exc:
        raise _http_error(exc)


@router.get("/api/items/{item_id}/images", response_model=list[ItemImageOut])
def list_images(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return image_service.list_images(db, current_user, item_id)
    except image_service.ImageNotFoundError as exc:
        raise _http_error(exc)


@router.get("/api/images/{item_id}/{filename}")
def serve_image(
    item_id: int,
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flex),
):
    """服务图片文件（需登录：header 或 ?token= query，供 <img> 直接引用）。"""
    try:
        file_path = image_service.get_image_file_path(db, current_user, item_id, filename)
    except image_service.ImageNotFoundError as exc:
        raise _http_error(exc)
    return FileResponse(file_path, media_type="image/webp")


@router.delete(
    "/api/items/{item_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_image(
    item_id: int,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        image_service.delete_image(db, current_user, item_id, image_id)
    except image_service.ImageNotFoundError as exc:
        raise _http_error(exc)
    return None
