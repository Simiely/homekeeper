"""应用入口：挂载路由、静态目录、CORS、启动时建表。"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import DATA_DIR, settings
from app.core.security import hash_password
from app.database import SessionLocal, init_db
from app.models.user import User
from app.routers import admin as admin_router_module
from app.routers import auth, borrow, categories, dashboard, data, images, items, locations, push, tags
from app.services import audit  # noqa: F401 — 激活操作日志监听器
from app.services.backup import (
    router as backup_router,
    start_scheduler as start_backup_scheduler,
    stop_scheduler as stop_backup_scheduler,
)

# [local-dev] 原仓库为 Path("/app/data/images")，Docker 内路径；本地改用相对路径
IMAGES_DIR = DATA_DIR / "images"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时建表 + 确保图片/备份目录存在 + 启动调度器 + seed admin
    init_db()
    _seed_admin()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    # [local-dev] 原为 Path("/app/data/backups")，Docker 内路径
    (DATA_DIR / "backups").mkdir(parents=True, exist_ok=True)
    push.start_scheduler()
    start_backup_scheduler()
    yield
    stop_backup_scheduler()
    push.stop_scheduler()


def _seed_admin():
    """启动时确保默认管理员账户存在。"""
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()
        if not existing:
            user = User(
                username="admin",
                hashed_password=hash_password("Mm123456."),
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
app.include_router(backup_router)

# 静态前端兜底挂载，必须在 API 路由之后
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
