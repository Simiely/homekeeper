"""数据库引擎、会话与 Base。"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import PROJECT_ROOT, settings

# 将相对 sqlite 路径（sqlite:///./data/... 或 sqlite:///data/...）解析为基于项目根目录的绝对路径，
# 避免数据库位置依赖"从哪个目录启动 uvicorn"（本地开发健壮性修复）；
# 绝对路径（sqlite:///C:/...、sqlite:////linux/...）保持不变。
_database_url = settings.database_url
if _database_url.startswith("sqlite:///"):
    _rel = _database_url[len("sqlite:///"):]
    is_abs = (
        _rel.startswith(("/", "\\"))
        or (len(_rel) > 2 and _rel[1:3].lower() in (":/", ":\\"))
    )
    if _rel and not is_abs:
        _database_url = f"sqlite:///{(PROJECT_ROOT / _rel).as_posix()}"

# SQLite 需要关闭同线程检查以在 FastAPI 异步上下文使用；
# timeout=30：busy 时等待锁最多 30s（默认 5s 太短，并发写易 database is locked）
connect_args = (
    {"check_same_thread": False, "timeout": 30}
    if _database_url.startswith("sqlite")
    else {}
)

engine = create_engine(_database_url, connect_args=connect_args)


@event.listens_for(engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    """SQLite 默认不启用外键约束；开启后 ondelete 策略（CASCADE/SET NULL）才生效。"""
    if _database_url.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL 模式：读写并发不互斥，显著降低写锁冲突（audit 事件监听器与业务同写时必需）
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """建表：导入模型确保注册到 Base.metadata。"""
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()


def _migrate_sqlite() -> None:
    """轻量迁移：为已存在的 SQLite 库补充新增列（create_all 不会给既有表加列）。

    后续新增模型列时在此追加对应的 ALTER TABLE 逻辑。
    """
    from sqlalchemy import inspect, text

    if not _database_url.startswith("sqlite"):
        return
    insp = inspect(engine)
    if not insp.has_table("locations"):
        return
    cols = {c["name"] for c in insp.get_columns("locations")}
    if "sort_order" not in cols:
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE locations ADD COLUMN sort_order INTEGER DEFAULT 0")
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
