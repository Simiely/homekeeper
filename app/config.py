"""应用配置：从环境变量 / .env 读取。

注意：以下 [local-dev] 标记的改动仅用于本地调试（Windows），
原仓库中对应的是 Docker 容器内的硬编码 /app/data/... 路径。
Docker 构建时这些行不会被用到（容器内有自己的 /app/data），
回退方法：全局搜索 [local-dev] 即可找到所有本地化改动。
"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# [local-dev] 项目根目录（app/ 的上一级），覆盖原仓库 Docker 内的硬编码 /app/data 路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
# [local-dev] 数据目录（数据库 / 图片 / 备份等）
DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_port: int = 8000
    database_url: str = "sqlite:///./data/homekeeper.db"
    secret_key: str = "change-me-to-a-long-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    cors_origins: str = "*"
    public_url: str = ""
    backup_interval_hours: int = 1
    backup_retention: int = 48
    # 首次启动自动创建的默认管理员密码（生产环境务必通过环境变量覆盖）
    default_admin_password: str = "Mm123456."

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
