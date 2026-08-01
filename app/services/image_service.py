"""图片业务逻辑：WebP 转码 / 磁盘路径 / 上传 / 列表 / 删除。"""
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image
from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.models.item_image import ItemImage
from app.models.user import User
from app.services.item_service import get_owned_item


class ImageNotFoundError(Exception):
    """图片不存在。"""


class ImageProcessError(Exception):
    """图片处理失败（非有效图片）。"""


# [local-dev] 原仓库为 Path("/app/data/images")，Docker 内路径
IMAGES_DIR = DATA_DIR / "images"
MAX_DIM = 2000  # 最长边像素上限
WEBP_QUALITY = 85


def process_image(file_bytes: bytes) -> tuple[bytes, int, int]:
    """转为 WebP，超 2000px 等比缩放。返回 (data, width, height)。"""
    img = Image.open(BytesIO(file_bytes))
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


def _image_path(item_id: int, filename: str) -> Path:
    """构造图片磁盘路径：data/images/{item_id}/{filename}"""
    return IMAGES_DIR / str(item_id) / filename


def _ensure_dir(item_id: int) -> Path:
    """确保 item 子目录存在，返回目录路径。"""
    d = IMAGES_DIR / str(item_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def upload_image(
    db: Session,
    user: User,
    item_id: int,
    raw: bytes,
    original_filename: str | None,
) -> ItemImage:
    """校验归属 → 转码 → 存盘 → 写 DB。"""
    get_owned_item(db, user, item_id)  # 404 校验
    if not raw:
        raise ImageProcessError("空文件")
    try:
        webp_data, width, height = process_image(raw)
    except Exception:
        raise ImageProcessError("图片处理失败")
    filename = f"{uuid.uuid4().hex}.webp"
    out_dir = _ensure_dir(item_id)
    (out_dir / filename).write_bytes(webp_data)
    record = ItemImage(
        item_id=item_id,
        filename=filename,
        original_name=original_filename or "",
        width=width,
        height=height,
        file_size=len(webp_data),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_images(db: Session, user: User, item_id: int) -> list[ItemImage]:
    get_owned_item(db, user, item_id)
    return (
        db.query(ItemImage)
        .filter(ItemImage.item_id == item_id)
        .order_by(ItemImage.created_at)
        .all()
    )


def get_image_file_path(db: Session, user: User, item_id: int, filename: str) -> Path:
    """校验归属与扩展名，返回存在的图片磁盘路径（不存在抛 ImageNotFoundError）。"""
    if not filename.endswith(".webp"):
        raise ImageNotFoundError("无效文件名")
    get_owned_item(db, user, item_id)
    file_path = _image_path(item_id, filename)
    if not file_path.exists():
        raise ImageNotFoundError("图片不存在")
    return file_path


def delete_image(db: Session, user: User, item_id: int, image_id: int) -> None:
    get_owned_item(db, user, item_id)
    record = (
        db.query(ItemImage)
        .filter(ItemImage.id == image_id, ItemImage.item_id == item_id)
        .first()
    )
    if not record:
        raise ImageNotFoundError("图片不存在")
    p = _image_path(item_id, record.filename)
    if p.exists():
        p.unlink()
    db.delete(record)
    db.commit()
