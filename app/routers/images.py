"""物品图片：上传 / 服务 / 删除。"""
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.item import Item
from app.models.item_image import ItemImage
from app.models.user import User
from app.schemas.item_image import ItemImageOut

router = APIRouter(tags=["images"])

IMAGES_DIR = Path("/app/data/images")
MAX_DIM = 2000  # 最长边像素上限
WEBP_QUALITY = 85


# ---- 图片处理 ----

def process_image(file_bytes: bytes) -> tuple[bytes, int, int]:
    """转为 WebP，超 2000px 等比缩放。返回 (data, width, height)。"""
    img = Image.open(BytesIO(file_bytes))
    # 处理 RGBA → RGB（WebP 支持 alpha，保留即可）
    w, h = img.size
    longest = max(w, h)
    if longest > MAX_DIM:
        ratio = MAX_DIM / longest
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        w, h = new_w, new_h
    buf = BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY)
    return buf.getvalue(), w, h


# ---- 文件路径 ----

def _image_path(item_id: int, filename: str) -> Path:
    """构造图片磁盘路径：data/images/{item_id}/{filename}"""
    return IMAGES_DIR / str(item_id) / filename


def _ensure_dir(item_id: int) -> Path:
    """确保 item 子目录存在，返回目录路径。"""
    d = IMAGES_DIR / str(item_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---- 上传 ----

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
    # 验证物品所有权
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")

    # 读取上传内容
    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="空文件")

    # 处理图片
    try:
        webp_data, width, height = process_image(raw)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="图片处理失败，请确认上传的是有效图片文件"
        )

    # 保存到磁盘
    filename = f"{uuid.uuid4().hex}.webp"
    out_dir = _ensure_dir(item_id)
    (out_dir / filename).write_bytes(webp_data)

    # 写入 DB
    record = ItemImage(
        item_id=item_id,
        filename=filename,
        original_name=file.filename or "",
        width=width,
        height=height,
        file_size=len(webp_data),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# ---- 列表 ----

@router.get("/api/items/{item_id}/images", response_model=list[ItemImageOut])
def list_images(
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
    return (
        db.query(ItemImage)
        .filter(ItemImage.item_id == item_id)
        .order_by(ItemImage.created_at)
        .all()
    )


# ---- 服务图片文件（无认证，供 <img> 直接引用） ----

@router.get("/api/images/{item_id}/{filename}")
def serve_image(item_id: int, filename: str):
    if not filename.endswith(".webp"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效文件名")
    file_path = _image_path(item_id, filename)
    if file_path.exists():
        return FileResponse(file_path, media_type="image/webp")
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在")


# ---- 删除 ----

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
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.owner_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物品不存在")
    record = (
        db.query(ItemImage)
        .filter(ItemImage.id == image_id, ItemImage.item_id == item_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在")

    # 删文件
    p = _image_path(item_id, record.filename)
    if p.exists():
        p.unlink()

    db.delete(record)
    db.commit()
