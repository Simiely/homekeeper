"""物品图片：上传 / 服务 / 删除。业务在 services/image_service.py。"""
from fastapi import APIRouter, Depends, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_current_user_flex
from app.models.user import User
from app.schemas.item_image import ItemImageOut
from app.services import image_service

router = APIRouter(tags=["images"])


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
    return image_service.upload_image(db, current_user, item_id, raw, file.filename)


@router.get("/api/items/{item_id}/images", response_model=list[ItemImageOut])
def list_images(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return image_service.list_images(db, current_user, item_id)


@router.get("/api/images/{item_id}/{filename}")
def serve_image(
    item_id: int,
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flex),
):
    """服务图片文件（需登录：header 或 ?token= query，供 <img> 直接引用）。"""
    file_path = image_service.get_image_file_path(db, current_user, item_id, filename)
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
    image_service.delete_image(db, current_user, item_id, image_id)
    return None
