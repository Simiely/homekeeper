"""pytest 公共 fixture：使用临时 SQLite，避免污染真实数据。"""
import os
import sys
import tempfile

# 将项目根目录加入 path，确保 `import app` 可用
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# 测试用临时数据库（绝对路径，独立于 ./data）
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

# 默认管理员账号（lifespan 启动时 seed）
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "Mm123456."


@pytest.fixture
def client():
    # 每个测试前重置表，保证隔离
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_token(client):
    """管理员登录 token。"""
    r = client.post(
        "/api/auth/login", data={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def create_user(client, admin_token):
    """以管理员身份创建用户，返回其登录 token（v0.8.0 起无公开注册）。"""

    def _create(username: str, password: str = "pw") -> str:
        r = client.post(
            "/api/admin/users",
            json={"username": username, "password": password},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 201, r.text
        r2 = client.post(
            "/api/auth/login", data={"username": username, "password": password}
        )
        assert r2.status_code == 200, r2.text
        return r2.json()["access_token"]

    return _create
