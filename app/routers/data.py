"""CSV 导入/导出：物品/位置/分类/标签。"""
import csv
import io
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.category import Category
from app.models.item import Item
from app.models.item_tag import item_tag_assoc
from app.models.location import Location
from app.models.tag import Tag
from app.models.user import User

logger = logging.getLogger("homekeeper.csv")
router = APIRouter(tags=["data"])

CSV_HEADERS = [
    "name",
    "description",
    "quantity",
    "unit",
    "status",
    "expiry_date",
    "purchase_date",
    "location",
    "location_note",
    "category",
    "tags",
]


# ========== 导出 ==========


def _row_for_item(item: Item, loc_map: dict, cat_map: dict, tag_map: dict) -> list:
    """将 Item ORM 对象转为 CSV 行。"""
    loc = loc_map.get(item.location_id, "")
    cat = cat_map.get(item.category_id, "")
    tags = tag_map.get(item.id, "")
    return [
        item.name,
        item.description,
        str(item.quantity or ""),
        item.unit or "",
        item.status.value if hasattr(item.status, "value") else str(item.status),
        item.expiry_date.isoformat() if item.expiry_date else "",
        item.purchase_date.isoformat() if item.purchase_date else "",
        loc,
        item.location_note or "",
        cat,
        tags,
    ]


@router.get("/api/export/items")
def export_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """导出当前用户的物品为 CSV。"""
    uid = current_user.id
    items = db.query(Item).filter(Item.owner_id == uid).order_by(Item.name).all()

    # 构建名称映射
    locs = {l.id: l.name for l in db.query(Location).filter(Location.owner_id == uid).all()}
    cats = {c.id: c.name for c in db.query(Category).filter(Category.owner_id == uid).all()}
    tags = db.query(Tag).filter(Tag.owner_id == uid).all()
    tag_names = {t.id: t.name for t in tags}

    # 物品 → 标签名（逗号分隔）
    item_tags = {}
    rows = db.execute(
        item_tag_assoc.select().where(
            item_tag_assoc.c.item_id.in_([it.id for it in items])
        )
    ).fetchall() if items else []
    for item_id, tag_id in rows:
        if item_id not in item_tags:
            item_tags[item_id] = []
        item_tags[item_id].append(tag_names.get(tag_id, ""))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_HEADERS)
    for item in items:
        writer.writerow(
            _row_for_item(item, locs, cats, {k: "、".join(v) for k, v in item_tags.items()})
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
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
    import zipfile
    from datetime import datetime

    uid = current_user.id
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 物品
        items = db.query(Item).filter(Item.owner_id == uid).order_by(Item.name).all()
        locs = {l.id: l.name for l in db.query(Location).filter(Location.owner_id == uid).all()}
        cats = {c.id: c.name for c in db.query(Category).filter(Category.owner_id == uid).all()}
        tag_names = {t.id: t.name for t in db.query(Tag).filter(Tag.owner_id == uid).all()}
        item_tags = {}
        if items:
            rows = db.execute(
                item_tag_assoc.select().where(
                    item_tag_assoc.c.item_id.in_([it.id for it in items])
                )
            ).fetchall()
            for item_id, tag_id in rows:
                item_tags.setdefault(item_id, []).append(tag_names.get(tag_id, ""))
        tag_strs = {k: "、".join(v) for k, v in item_tags.items()}

        s = io.StringIO()
        w = csv.writer(s)
        w.writerow(CSV_HEADERS)
        for it in items:
            w.writerow(_row_for_item(it, locs, cats, tag_strs))
        zf.writestr("items.csv", s.getvalue().encode("utf-8-sig"))

        # 位置
        s = io.StringIO()
        w = csv.writer(s)
        w.writerow(["name", "parent", "note"])
        loc_rows = db.query(Location).filter(Location.owner_id == uid).order_by(Location.id).all()
        loc_names = {l.id: l.name for l in loc_rows}
        for l in loc_rows:
            w.writerow([l.name, loc_names.get(l.parent_id, ""), l.note])
        zf.writestr("locations.csv", s.getvalue().encode("utf-8-sig"))

        # 分类
        s = io.StringIO()
        w = csv.writer(s)
        w.writerow(["name", "color"])
        for c in db.query(Category).filter(Category.owner_id == uid).order_by(Category.name).all():
            w.writerow([c.name, c.color])
        zf.writestr("categories.csv", s.getvalue().encode("utf-8-sig"))

        # 标签
        s = io.StringIO()
        w = csv.writer(s)
        w.writerow(["name", "color"])
        for t in db.query(Tag).filter(Tag.owner_id == uid).order_by(Tag.name).all():
            w.writerow([t.name, t.color])
        zf.writestr("tags.csv", s.getvalue().encode("utf-8-sig"))

    buf.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=homekeeper_backup_{ts}.zip",
        },
    )


# ========== 导入 ==========


@router.post("/api/import/items")
def import_items(
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """从 CSV 文件导入物品（匹配位置/分类/标签名称）。"""
    uid = current_user.id

    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="请上传 .csv 文件")

    content = file.file.read()
    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = content.decode("utf-8")

    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV 文件为空或格式错误")

    # 验证表头
    required = {"name"}
    headers = set(reader.fieldnames)
    if not required.issubset(headers):
        raise HTTPException(
            status_code=400,
            detail=f"CSV 缺少必要列: {required - headers}，当前列: {headers}",
        )

    # 缓存现有的位置/分类/标签（按名称查找）
    loc_map = {l.name: l.id for l in db.query(Location).filter(Location.owner_id == uid).all()}
    cat_map = {c.name: c.id for c in db.query(Category).filter(Category.owner_id == uid).all()}
    tag_map = {t.name: t.id for t in db.query(Tag).filter(Tag.owner_id == uid).all()}

    imported = 0
    errors = []

    for i, row in enumerate(reader, start=2):
        try:
            name = row.get("name", "").strip()
            if not name:
                errors.append(f"第 {i} 行: 名称为空，跳过")
                continue

            # 解析位置
            loc_name = row.get("location", "").strip()
            location_id = loc_map.get(loc_name) if loc_name else None

            # 解析分类
            cat_name = row.get("category", "").strip()
            category_id = cat_map.get(cat_name) if cat_name else None

            # 解析数量
            qty_str = row.get("quantity", "1").strip()
            quantity = float(qty_str) if qty_str else 1

            # 解析日期
            expiry = None
            purchase = None
            expiry_str = row.get("expiry_date", "").strip()
            purchase_str = row.get("purchase_date", "").strip()
            if expiry_str:
                try:
                    expiry = date.fromisoformat(expiry_str)
                except ValueError:
                    pass
            if purchase_str:
                try:
                    purchase = date.fromisoformat(purchase_str)
                except ValueError:
                    pass

            item = Item(
                owner_id=uid,
                name=name,
                description=row.get("description", "").strip(),
                quantity=quantity,
                unit=row.get("unit", "个").strip() or "个",
                status=row.get("status", "在库").strip() or "在库",
                expiry_date=expiry,
                purchase_date=purchase,
                location_id=location_id,
                location_note=row.get("location_note", "").strip() or "",
                category_id=category_id,
            )
            db.add(item)
            db.flush()

            # 处理标签
            tags_str = row.get("tags", "").strip()
            if tags_str:
                for tag_name in tags_str.replace("、", ",").split(","):
                    tag_name = tag_name.strip()
                    tag_id = tag_map.get(tag_name)
                    if tag_id:
                        # 使用 raw SQL 插入关联表
                        db.execute(
                            item_tag_assoc.insert().values(item_id=item.id, tag_id=tag_id)
                        )

            imported += 1
        except Exception as e:
            errors.append(f"第 {i} 行: {e}")
            continue

    db.commit()
    return {
        "ok": True,
        "imported": imported,
        "errors": errors[:20],  # 最多返回 20 条错误
        "total_errors": len(errors),
    }
