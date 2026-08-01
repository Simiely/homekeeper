# 拾光集

> 记录物品**位置**、**保质期**、**状态**的轻量家居管理工具。Docker 一键部署、浏览器访问；
> 支持多用户登录（JWT 鉴权、管理员创建用户、数据隔离）；预留 REST API 供后续安卓端远程调用。

<div align="center">

![Build](https://github.com/Simiely/homekeeper/actions/workflows/docker-build.yml/badge.svg)
![Docker Image](https://ghcr.io/simiely/homekeeper/badge.svg)

</div>

---

## 快速上手（3 步）

### 方式 A：拉取预构建镜像（推荐）

```bash
docker run -d --name homekeeper \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -e SECRET_KEY="改为随机字符串" \
  -e DEFAULT_ADMIN_PASSWORD="改为强密码" \
  ghcr.io/simiely/homekeeper:latest
```

### 方式 B：从源码构建

1. **准备配置**：复制 `.env.example` 为 `.env`，并把 `SECRET_KEY` 改成随机长字符串
   ```bash
   cp .env.example .env
   # 生成密钥示例：python -c "import secrets;print(secrets.token_hex(32))"
   ```
2. **启动**（首次会自动构建镜像）
   ```bash
   docker compose up -d --build
   ```
3. **访问**：浏览器打开 `http://<服务器IP>:8000`，使用管理员账号 `admin` 登录。
   > **首次登录密码**：部署时通过环境变量 `DEFAULT_ADMIN_PASSWORD` 自行设置（见 `.env.example`）；未设置则启动时生成随机密码并打印在日志中，登录后请立即修改。
   > 默认禁止公开注册，管理员登录后在「管理」页创建普通用户。

> 数据落在 `./data/homekeeper.db`（已通过卷挂载持久化，重启不丢）。
> 交互式 API 文档：`http://<服务器IP>:8000/docs`

---

## 功能概览

| 模块 | 能力 |
|------|------|
| 账号 | 管理员创建用户 / 登录（JWT），数据按用户隔离；初始 admin 密码由部署者通过 `DEFAULT_ADMIN_PASSWORD` 设置 |
| 物品 | 名称、描述、数量、单位、**状态**、**保质期**、购买日期、**图片附件** |
| 位置 | **方块卡片层级树**（显示物品数量）+ 编辑模式拖拽调层级 + 点击展开物品列表 + 内联添加/改名 |
| 分类 | 带颜色的标签 / 分类 |
| 概览 | 总数统计、按状态分布、按分类分布、可调天数即将过期提醒 |
| 筛选 | 物品按关键词 / 状态 / 分类 / 位置四维组合搜索 |
| 图片 | 拍照上传 → 自动 WebP 压缩 → 超 2000px 缩放 → 缩略图预览 |
| 通知 | Web Push 推送：物品过期前 3 天自动提醒（桌面/iOS PWA） |
| 管理 | 管理员用户管理：查看用户 / 添加用户 / 删除用户 |
| 主题 | 深色/浅色双主题切换，背景图自适应，localStorage 持久化 |
| 适配 | 响应式布局：支持手机 / 平板 / 桌面三断点适配 |

---

## 文档导航（总索引）

| 文档 | 说明 |
|------|------|
| [功能说明](docs/01-功能说明.md) | 功能清单、数据模型、状态字典、使用流程 |
| [更新日志](docs/02-更新日志(CHANGELOG).md) | 版本快照（v0.1.0 起），变更/新增/修复 |
| [踩坑与排错](docs/03-踩坑与排错.md) | 开发与部署中遇到的问题 + 根因 + 解决方案 |
| [部署指南](docs/04-部署指南.md) | Docker 部署、远程访问、HTTPS、数据备份 |
| [开发指南](docs/05-开发指南.md) | 模块化结构、如何新增功能、API 约定 |
| [安卓端规划](docs/06-安卓端规划.md) | 供安卓端使用的 API 与远程连接方案 |
| [推送方案汇总](docs/07-推送方案汇总.md) | Web Push（当前）+ 备选方案 |
| [模块化重构计划](docs/08-模块化重构计划.md) | A-D/E-F 阶段重构执行记录（历史） |
| [模块化梳理计划](docs/09-模块化梳理计划.md) | 2026-08 全面审核 + services 下沉（当前） |

---

## 技术栈

`FastAPI` · `SQLite` · 原生 `HTML/CSS/JS` · `SQLAlchemy 2.x` · `Pydantic v2` · `JWT`

---

## 目录结构

见 [开发指南 · 目录结构](docs/05-开发指南.md#目录结构)。

---

> 当前版本：**v0.9.3+** — 位置页交互改版（编辑模式单击改名/拖动调层级、非编辑模式点击展开物品、触屏 Pointer 支持）+ 后端 services 层下沉重构。详见 [更新日志](docs/02-更新日志(CHANGELOG).md)。
