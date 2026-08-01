"""位置 CRUD（层级树）。删除父级时，子位置自动提升一级。"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.location import Location
from app.models.user import User
from app.schemas.location import (
    LocationCreate,
    LocationOut,
    LocationReorderItem,
    LocationTreeNode,
    LocationUpdate,
)

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Location)
        .filter(Location.owner_id == current_user.id)
        .order_by(Location.parent_id, Location.sort_order, Location.id)
        .all()
    )


@router.put("/reorder")
def reorder_locations(
    payload: list[LocationReorderItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """拖拽排序后批量保存：仅更新 parent_id 与同级 sort_order（扁平结构，避免全量递归）。

    - 归属校验：所有 id 必须属于当前用户
    - 父位置校验：parent_id 必须存在且属于当前用户
    - 环检测：禁止把节点移动到自己的后代下（会形成循环引用）
    """
    if not payload:
        return {"ok": True, "updated": 0}

    ids = list({item.id for item in payload})
    owned = {
        loc.id: loc
        for loc in db.query(Location)
        .filter(Location.owner_id == current_user.id, Location.id.in_(ids))
        .all()
    }
    if len(owned) != len(ids):
        raise HTTPException(status_code=400, detail="包含无效或不属于当前用户的位置")

    parent_ids = {item.parent_id for item in payload if item.parent_id is not None}
    if parent_ids:
        valid_parents = set(
            row[0]
            for row in db.query(Location.id)
            .filter(Location.owner_id == current_user.id, Location.id.in_(parent_ids))
            .all()
        )
        missing = parent_ids - valid_parents
        if missing:
            raise HTTPException(status_code=400, detail=f"父位置不存在: {sorted(missing)}")

    # 环检测：基于"数据库现有关系 + 本次新结构"合并追溯。
    # 链路可能经过不在 payload 中的节点（API 不能假设客户端传全量树），
    # 因此必须用当前用户的全部位置构建完整 parent 映射。
    all_parents = {
        loc.id: loc.parent_id
        for loc in db.query(Location).filter(Location.owner_id == current_user.id).all()
    }
    for item in payload:
        all_parents[item.id] = item.parent_id  # 本次变更优先
    for item in payload:
        cur = item.parent_id
        seen: set[int] = set()
        while cur is not None:
            if cur == item.id:
                raise HTTPException(
                    status_code=400, detail="不能将位置移动到自己的子级下（会形成循环）"
                )
            if cur in seen:
                break
            seen.add(cur)
            cur = all_parents.get(cur)

    # 批量更新（幂等：重复拖拽同一结构无副作用）
    for item in payload:
        loc = owned[item.id]
        loc.parent_id = item.parent_id
        loc.sort_order = item.sort_order
    db.commit()
    return {"ok": True, "updated": len(payload)}


@router.get("/tree", response_model=list[LocationTreeNode])
def list_location_tree(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """返回按 parent_id 组装的层级树。"""
    locations = (
        db.query(Location)
        .filter(Location.owner_id == current_user.id)
        .order_by(Location.id)
        .all()
    )
    lookup = {
        loc.id: {
            "id": loc.id,
            "name": loc.name,
            "parent_id": loc.parent_id,
            "note": loc.note,
            "children": [],
        }
        for loc in locations
    }
    roots: list[dict] = []
    for node in lookup.values():
        if node["parent_id"] is None:
            roots.append(node)
        elif node["parent_id"] in lookup:
            lookup[node["parent_id"]]["children"].append(node)
    return roots


@router.get("/{loc_id}", response_model=LocationOut)
def get_location(
    loc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loc = (
        db.query(Location)
        .filter(Location.id == loc_id, Location.owner_id == current_user.id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="位置不存在")
    return loc


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 新位置排到同级末尾（sort_order = 同级最大值 + 1）
    max_order = (
        db.query(func.max(Location.sort_order))
        .filter(
            Location.owner_id == current_user.id,
            Location.parent_id == payload.parent_id,
        )
        .scalar()
    )
    loc = Location(
        owner_id=current_user.id,
        sort_order=(max_order or 0) + 1,
        **payload.model_dump(),
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


@router.put("/{loc_id}", response_model=LocationOut)
def update_location(
    loc_id: int,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loc = (
        db.query(Location)
        .filter(Location.id == loc_id, Location.owner_id == current_user.id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="位置不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(loc, key, value)
    db.commit()
    db.refresh(loc)
    return loc


@router.delete("/{loc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    loc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loc = (
        db.query(Location)
        .filter(Location.id == loc_id, Location.owner_id == current_user.id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="位置不存在")
    # 子位置提升一级（挂到被删位置的父级）
    for child in db.query(Location).filter(Location.parent_id == loc_id).all():
        child.parent_id = loc.parent_id
    db.delete(loc)
    db.commit()
