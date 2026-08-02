"""CSV 导入/导出：物品/位置/分类/标签。业务在 services/data_service.py。"""
import logging

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services import data_service

logger = logging.getLogger("homekeeper.csv")
router = APIRouter(tags=["data"])


@router.get("/api/export/items")
def export_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """导出当前用户的物品为 CSV。"""
    csv_content = data_service.export_items_csv(db, current_user)
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": "attachment; filename=homekeeper_items.csv",
        },
    )


@router.get("/api/export/all")
def export_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """导出全部数据（多 CSV 打包为 ZIP）。"""
    zip_bytes, filename = data_service.export_all_zip(db, current_user)
    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
        },
    )


@router.post("/api/import/items")
def import_items(
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """从 CSV 文件导入物品（匹配位置/分类/标签名称）。"""
    content = file.file.read()
    return data_service.import_items_from_csv(db, current_user, content, file.filename)
