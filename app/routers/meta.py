"""应用元数据：状态字典等常量，供前端渲染下拉（单一数据源，避免前后端各写一份）。"""
from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.models.status import ItemStatus

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("")
def get_meta(current_user=Depends(get_current_user)):
    """返回前端所需的字典数据。新增状态只需改 models/status.py。"""
    return {
        "statuses": [s.value for s in ItemStatus],
    }
