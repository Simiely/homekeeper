"""应用入口：挂载路由、静态目录、CORS、启动时建表。"""
import logging
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import DATA_DIR, settings
from app.core.security import hash_password
from app.database import SessionLocal, init_db
from app.models.user import User
from app.routers import admin as admin_router_module
from app.routers import (
    auth,
    backup as backup_router_module,
    borrow,
    categories,
    dashboard,
    data,
    images,
    items,
    locations,
    meta,
    push,
    tags,
)
from app.services import audit  # noqa: F401 — 激活操作日志监听器
from app.services import scheduler as scheduler_mgr
from app.services.backup import BackupCorruptError, BackupNotFoundError
from app.services.borrow_service import BorrowNotFoundError
from app.services.category_service import CategoryNotFoundError
from app.services.item_service import ItemNotFoundError
from app.services.tag_service import TagNotFoundError
from app.services.user_service import CannotDeleteSelfError, UsernameExistsError, UserNotFoundError

logger = logging.getLogger("homekeeper.main")

# [local-dev] 原仓库为 Path("/app/data/images")，Docker 内路径；本地改用相对路径
IMAGES_DIR = DATA_DIR / "images"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 先确保数据/图片/备份目录存在（init_db 依赖 data/，必须在前）
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    # [local-dev] 原为 Path("/app/data/backups")，Docker 内路径
    (DATA_DIR / "backups").mkdir(parents=True, exist_ok=True)
    # 启动时建表 + seed admin + 启动全部调度器
    init_db()
    _seed_admin()
    scheduler_mgr.start_all()
    yield
    scheduler_mgr.stop_all()


def _seed_admin():
    """启动时确保默认管理员账户存在。

    密码来源：
    1. 环境变量 DEFAULT_ADMIN_PASSWORD（推荐，部署时显式设置强密码）；
    2. 未设置则生成随机密码并打印到日志（仅此一次，登录后请立即修改）。
    """
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()
        if not existing:
            password = settings.default_admin_password
            if not password:
                password = secrets.token_urlsafe(12)
                logging.getLogger("uvicorn.error").warning(
                    "未设置 DEFAULT_ADMIN_PASSWORD，已为 admin 生成随机密码：%s "
                    "（请登录后立即修改，或在 .env 中设置该变量后重建数据库）",
                    password,
                )
            user = User(
                username="admin",
                hashed_password=hash_password(password),
                is_admin=True,
            )
            db.add(user)
            db.commit()
    finally:
        db.close()


app = FastAPI(title="拾光集", version="0.9.6", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 领域异常 → HTTP 映射（全局统一，消除各 router 重复 try/except 映射）
@app.exception_handler(ItemNotFoundError)
async def item_not_found_handler(request: Request, exc: ItemNotFoundError):
    return JSONResponse(status_code=404, content={"detail": "物品不存在"})


@app.exception_handler(TagNotFoundError)
async def tag_not_found_handler(request: Request, exc: TagNotFoundError):
    return JSONResponse(status_code=404, content={"detail": "标签不存在"})


@app.exception_handler(CategoryNotFoundError)
async def category_not_found_handler(request: Request, exc: CategoryNotFoundError):
    return JSONResponse(status_code=404, content={"detail": "分类不存在"})


@app.exception_handler(BorrowNotFoundError)
async def borrow_not_found_handler(request: Request, exc: BorrowNotFoundError):
    return JSONResponse(status_code=404, content={"detail": "借用记录不存在"})


@app.exception_handler(UserNotFoundError)
async def user_not_found_handler(request: Request, exc: UserNotFoundError):
    return JSONResponse(status_code=404, content={"detail": "用户不存在"})


@app.exception_handler(UsernameExistsError)
async def username_exists_handler(request: Request, exc: UsernameExistsError):
    return JSONResponse(status_code=400, content={"detail": "用户名已存在"})


@app.exception_handler(CannotDeleteSelfError)
async def cannot_delete_self_handler(request: Request, exc: CannotDeleteSelfError):
    return JSONResponse(status_code=400, content={"detail": "不能删除自己"})


@app.exception_handler(BackupNotFoundError)
async def backup_not_found_handler(request: Request, exc: BackupNotFoundError):
    return JSONResponse(status_code=404, content={"detail": "备份文件不存在"})


@app.exception_handler(BackupCorruptError)
async def backup_corrupt_handler(request: Request, exc: BackupCorruptError):
    return JSONResponse(status_code=400, content={"detail": f"备份文件损坏或无法打开：{exc}"})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """统一兜底：未捕获异常记录日志并返回 JSON，避免向客户端泄露堆栈。"""
    logger.exception("未处理异常: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误，请查看服务日志"})

app.include_router(admin_router_module.router)
app.include_router(auth.router)
app.include_router(items.router)
app.include_router(locations.router)
app.include_router(categories.router)
app.include_router(dashboard.router)
app.include_router(images.router)
app.include_router(push.router)
app.include_router(tags.router)
app.include_router(borrow.router)
app.include_router(data.router)
app.include_router(meta.router)
app.include_router(backup_router_module.router)

# 静态前端兜底挂载，必须在 API 路由之后
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
