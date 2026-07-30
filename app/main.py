"""应用入口：挂载路由、静态目录、CORS、启动时建表。"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import auth, categories, dashboard, images, items, locations, push, tags

IMAGES_DIR = Path("/app/data/images")

# 注意：静态目录 app/static 必须存在，否则启动失败（见 Dockerfile / 部署指南）
app = FastAPI(title="HomeKeeper 物管家", version="0.1.0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时建表 + 确保图片目录存在 + 启动推送调度器
    init_db()
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    push.start_scheduler()
    yield
    push.stop_scheduler()


app = FastAPI(title="HomeKeeper 物管家", version="0.5.0", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(items.router)
app.include_router(locations.router)
app.include_router(categories.router)
app.include_router(dashboard.router)
app.include_router(images.router)
app.include_router(push.router)
app.include_router(tags.router)

# 静态前端兜底挂载，必须在 API 路由之后
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
