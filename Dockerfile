FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 先装依赖，利用镜像层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 再拷贝源码
COPY . .

# 数据卷目录，赋权避免 SQLite 写入权限问题
RUN mkdir -p /app/data && chmod 777 /app/data

EXPOSE 8000

# 容器内固定监听 8000，宿主机端口由 docker-compose 映射决定
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
