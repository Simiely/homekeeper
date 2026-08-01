"""应用入口：挂载路由、静态目录、CORS、启动时建表。"""
import logging
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
    """启动时确保默认管理员账户存在（密码取自配置 DEFAULT_ADMIN_PASSWORD）。"""
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()
        if not existing:
            user = User(
                username="admin",
                hashed_password=hash_password(settings.default_admin_password),
                is_admin=True,
            )
            db.add(user)
            db.commit()
    finally:
        db.close()


app = FastAPI(title="拾光集", version="0.5.0", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
