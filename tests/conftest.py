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


@pytest.fixture
def client():
    # 每个测试前重置表，保证隔离
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
