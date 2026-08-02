"""数据导入导出业务：物品/位置/分类/标签 CSV 与 ZIP 打包。"""
import csv
import io
import zipfile
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.item import Item
from app.models.status import ItemStatus, status_value
from app.models.item_tag import item_tag_assoc
from app.models.location import Location
from app.models.tag import Tag
from app.models.user import User


class DataImportError(Exception):
    """导入数据不合法。"""


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
        status_value(item.status),
        item.expiry_date.isoformat() if item.expiry_date else "",
        item.purchase_date.isoformat() if item.purchase_date else "",
        loc,
        item.location_note or "",
        cat,
        tags,
    ]


def _items_csv(uid: int, db: Session) -> str:
    """生成当前用户的物品 CSV 内容（export_items 与 export_all 共用）。"""
    items = db.query(Item).filter(Item.owner_id == uid).order_by(Item.name).all()
    locs = {l.id: l.name for l in db.query(Location).filter(Location.owner_id == uid).all()}
    cats = {c.id: c.name for c in db.query(Category).filter(Category.owner_id == uid).all()}
    tag_names = {t.id: t.name for t in db.query(Tag).filter(Tag.owner_id == uid).all()}
    item_tags: dict[int, list[str]] = {}
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
    return s.getvalue()


def export_items_csv(db: Session, user: User) -> str:
    """导出当前用户的物品为 CSV 字符串。"""
    return _items_csv(user.id, db)


def export_all_zip(db: Session, user: User) -> tuple[bytes, str]:
    """导出全部数据（多 CSV 打包为 ZIP）。返回 (zip_bytes, filename)。"""
    uid = user.id
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 物品（复用 _items_csv）
        zf.writestr("items.csv", _items_csv(uid, db).encode("utf-8-sig"))

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
    return buf.getvalue(), f"homekeeper_backup_{ts}.zip"


def import_items_from_csv(db: Session, user: User, content: bytes, filename: str | None) -> dict:
    """从 CSV 内容导入物品（匹配位置/分类/标签名称）。"""
    uid = user.id

    if not filename or not filename.endswith(".csv"):
        raise DataImportError("请上传 .csv 文件")

    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = content.decode("utf-8")

    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise DataImportError("CSV 文件为空或格式错误")

    # 验证表头
    required = {"name"}
    headers = set(reader.fieldnames)
    if not required.issubset(headers):
        raise DataImportError(
            f"CSV 缺少必要列: {required - headers}，当前列: {headers}"
        )

    # 缓存现有的位置/分类/标签（按名称查找）
    loc_map = {l.name: l.id for l in db.query(Location).filter(Location.owner_id == uid).all()}
    cat_map = {c.name: c.id for c in db.query(Category).filter(Category.owner_id == uid).all()}
    tag_map = {t.name: t.id for t in db.query(Tag).filter(Tag.owner_id == uid).all()}

    imported = 0
    errors = []

    for i, row in enumerate(reader, start=2):
        try:
            # SAVEPOINT：单行失败只回滚本行，不影响其他行与最终 commit
            with db.begin_nested():
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
                    status=row.get("status", ItemStatus.IN_STOCK.value).strip() or ItemStatus.IN_STOCK.value,
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
