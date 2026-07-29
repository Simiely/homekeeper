"""应用入口：挂载路由、静态目录、CORS、启动时建表。"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import auth, categories, dashboard, items, locations

# 注意：静态目录 app/static 必须存在，否则启动失败（见 Dockerfile / 部署指南）
app = FastAPI(title="HomeKeeper 物管家", version="0.1.0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="HomeKeeper 物管家", version="0.1.0", lifespan=lifespan)


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

# 静态前端兜底挂载，必须在 API 路由之后
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
