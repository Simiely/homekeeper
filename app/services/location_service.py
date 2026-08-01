"""位置业务逻辑：CRUD / 层级树 / 拖拽重排（含归属、父级、环检测）。"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.location import Location
from app.models.user import User
from app.schemas.location import LocationCreate, LocationReorderItem, LocationUpdate


class LocationNotFoundError(Exception):
    """位置不存在（或不属于当前用户）。"""


class LocationInvalidError(Exception):
    """位置数据不合法（无效归属 / 父级不存在 / 形成循环）。"""


def get_owned_location(db: Session, user: User, loc_id: int) -> Location:
    loc = (
        db.query(Location)
        .filter(Location.id == loc_id, Location.owner_id == user.id)
        .first()
    )
    if not loc:
        raise LocationNotFoundError(loc_id)
    return loc


def list_locations(db: Session, user: User) -> list[Location]:
    return (
        db.query(Location)
        .filter(Location.owner_id == user.id)
        .order_by(Location.parent_id, Location.sort_order, Location.id)
        .all()
    )


def build_location_tree(db: Session, user: User) -> list[dict]:
    """返回按 parent_id 组装的层级树（顶层 = parent_id 为 None）。"""
    locations = (
        db.query(Location)
        .filter(Location.owner_id == user.id)
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


def create_location(db: Session, user: User, payload: LocationCreate) -> Location:
    # 新位置排到同级末尾（sort_order = 同级最大值 + 1）
    max_order = (
        db.query(func.max(Location.sort_order))
        .filter(
            Location.owner_id == user.id,
            Location.parent_id == payload.parent_id,
        )
        .scalar()
    )
    loc = Location(
        owner_id=user.id,
        sort_order=(max_order or 0) + 1,
        **payload.model_dump(),
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


def update_location(db: Session, user: User, loc_id: int, payload: LocationUpdate) -> Location:
    loc = get_owned_location(db, user, loc_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(loc, key, value)
    db.commit()
    db.refresh(loc)
    return loc


def delete_location(db: Session, user: User, loc_id: int) -> None:
    loc = get_owned_location(db, user, loc_id)
    # 子位置提升一级（挂到被删位置的父级）
    for child in db.query(Location).filter(Location.parent_id == loc_id).all():
        child.parent_id = loc.parent_id
    db.delete(loc)
    db.commit()


def reorder_locations(db: Session, user: User, payload: list[LocationReorderItem]) -> int:
    """拖拽排序后批量保存：仅更新 parent_id 与同级 sort_order（扁平结构）。

    - 归属校验：所有 id 必须属于当前用户
    - 父位置校验：parent_id 必须存在且属于当前用户
    - 环检测：禁止把节点移动到自己的后代下（会形成循环引用）
    """
    if not payload:
        return 0

    ids = list({item.id for item in payload})
    owned = {
        loc.id: loc
        for loc in db.query(Location)
        .filter(Location.owner_id == user.id, Location.id.in_(ids))
        .all()
    }
    if len(owned) != len(ids):
        raise LocationInvalidError("包含无效或不属于当前用户的位置")

    parent_ids = {item.parent_id for item in payload if item.parent_id is not None}
    if parent_ids:
        valid_parents = set(
            row[0]
            for row in db.query(Location.id)
            .filter(Location.owner_id == user.id, Location.id.in_(parent_ids))
            .all()
        )
        missing = parent_ids - valid_parents
        if missing:
            raise LocationInvalidError(f"父位置不存在: {sorted(missing)}")

    # 环检测：基于"数据库现有关系 + 本次新结构"合并追溯。
    # 链路可能经过不在 payload 中的节点（API 不能假设客户端传全量树），
    # 因此必须用当前用户的全部位置构建完整 parent 映射。
    all_parents = {
        loc.id: loc.parent_id
        for loc in db.query(Location).filter(Location.owner_id == user.id).all()
    }
    for item in payload:
        all_parents[item.id] = item.parent_id  # 本次变更优先
    for item in payload:
        cur = item.parent_id
        seen: set[int] = set()
        while cur is not None:
            if cur == item.id:
                raise LocationInvalidError(
                    "不能将位置移动到自己的子级下（会形成循环）"
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
    return len(payload)
