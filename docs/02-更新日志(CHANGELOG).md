# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循大致的语义化。

---

---

## [v0.7.0] - 2026-07-30

### 新增
- **自动备份**：定时备份 SQLite（默认每小时，保留 48 份）| 手动触发备份 | 从备份恢复
- **CSV 导入导出**：导出物品/ZIP（含位置/分类/标签）| 上传 CSV 批量导入（按名称匹配）
- **物品归档**：标记已用完物品，默认隐藏，勾选「显示已归档」可查看/恢复
- **批量操作**：复选框 + 全选 + 底部操作栏 → 批量归档/删除/改状态/改分类
- **序列号+保修**：记录电子产品的序列号和保修到期日（仪表盘保修提醒）
- **资产价值统计**：记录物品价格，概览页显示资产总值和分类资产分布
- **QR 码生成**：每件物品生成 PNG 二维码（可配置公开 URL 编码为链接）
- **借用记录**：记录借用人/借出日期/预计归还/归还状态（物品列表「借」按钮）
- **操作日志**：创建/修改/删除自动记录（字段级变更对比），前端时间线弹窗

### 修复
- 仪表盘 `GET /api/dashboard/expiring` 返回格式改为对象（`{expiring, warranty_expiring}`）

## [v0.6.1] - 2026-07-30

### 修复（19 个问题——全代码审计）

#### 严重 Bug
- **items.js**：修复 `currentPage` TDZ 导致物品视图首屏崩溃（`let` 声明移到 `loadItems()` 之前）
- **push.py**：修复 APScheduler 异常时 DB 会话泄漏（`try/finally` 保证 `db.close()`）
- **item.py**：`location_id` / `category_id` 外键加 `ondelete="SET NULL"`，删除被引用的分类/位置不再抛 500

#### 前端 Bug
- **items.js**：标签多选下拉现在实际生效——`buildPayload()` 忽略标签、表单提交未处理标签关联、编辑时不回填
- **categories.js**：分类颜色圆点可视化（`span.dot` 引用了不存在的 CSS 类，改为内联样式）
- **items.py**：`total_pages` 在 `total=0` 时返回 0（原返回 1）
- **categories.js / tags.js**：增加前端编辑功能（编/保存/取消按钮 + 表单回填）

#### 代码清理
- 🆕 **utils.js**：提取 `escapeHtml` / `buildLocTree` / `buildTreeOptions` 为共用模块，5 个 JS 文件改为 `import`
- **locations.js / categories.js / dashboard.js / tags.js**：删除本地重复的 `escapeHtml` / `buildTree` 函数

#### 加固
- **items.py**：删除物品时清理磁盘图片文件（`data/images/{item_id}/`）
- **images.py**：图片服务 URL 改为 `/api/images/{item_id}/{filename}`，O(1) 直接读取（原遍历所有子目录）

#### 杂项
- **CORS**：移除 `allow_credentials=True`（与 `allow_origins=["*"]` 冲突，浏览器会拒绝）
- **deps.py**：`tokenUrl` 补前导 `/`
- **main.py**：移除废弃的重复 `app = FastAPI()` 定义
- **app.js**：`initPush()` 仅在已登录时执行，避免重定向前竞态
- 补 `GET /{id}` 端点：分类 / 位置 / 标签
- **PWA**：`manifest.json` 加 SVG 图标引用

---

## [v0.5.0] - 2026-07-30

### 新增
- **Web Push 推送通知**（过期物品提醒）：
  - VAPID 密钥首次启动自动生成，持久化于 `data/vapid.json`
  - `GET /api/push/vapid-public-key` — 浏览器获取公钥用于订阅
  - `POST /api/push/subscribe` — 保存推送订阅
  - `POST /api/push/unsubscribe` — 取消订阅
- **定时扫描调度器**（APScheduler）：
  - 每 6 小时扫描所有用户 **3 天内过期** 的物品
  - 批量推送合并为一条通知（最多 5 件 + 余数统计）
  - 无效订阅自动清理（410 Gone）
- **Service Worker**：
  - 独立 `service-worker.js`，接收 push event 弹系统通知
  - 点击通知回到首页
- **PWA 支持**：
  - `manifest.json` 主题色、独立显示模式
  - 顶部栏推送状态按钮（🔕/🔔），点击首次授权
  - 自动检测权限状态：未配置/已拒绝/已授权

### 依赖
- `requirements.txt` 新增 `pywebpush`, `apscheduler`

## [v0.4.0] - 2026-07-30

### 新增
- **物品图片附件**：每条物品可拍照上传图片（`POST /api/items/{id}/images`）
  - 后端自动转为 **WebP 格式**（quality=85）
  - 最长边超过 **2000px** 自动等比缩放（LANCZOS 重采样）
  - 存储于 `data/images/{item_id}/{uuid}.webp`，Docker 卷持久化
- **图片管理 API**：
  - `GET /api/items/{id}/images` — 获取物品图片列表
  - `GET /api/images/{filename}` — 服务图片文件（供 `<img>` 直接引用）
  - `DELETE /api/items/{id}/images/{img_id}` — 删除图片（删文件+删记录）
- **前端图片交互**：
  - 物品列表增加「图片」列
  - 有图片 → 显示 60×60 WebP 缩略图，点击放大至全屏预览
  - 无图片 → 显示「+」上传按钮，点击选文件后自动上传并刷新列表
  - 上传过程有加载态指示

### 依赖
- `requirements.txt` 新增 `Pillow>=10.0`（图片处理引擎）

---

## [v0.3.0] - 2026-07-30

### 新增
- **位置层级树可视化**：
  - 后端 `GET /api/locations/tree` 返回嵌套 JSON 树结构（递归 `LocationTreeNode` schema）
  - 位置页面由扁平表格改为嵌套 `<ul>`/`<li>` 树状视图，缩进展示父子层级
  - 新增位置的「父级」选择器改为深度缩进下拉（不再手动填数字）
- **物品页位置选择器增强**：
  - 物品表单与筛选栏的位置下拉均改为深度缩进选项（`　├── 货架A`）
  - 物品列表「位置」列显示完整路径（`储物间 > 货架A`），而非仅名称

### 优化
- CSS 新增 `.tree` / `.tree-icon` / `.tree-btn` 系列样式，深色主题键鼠友好

---

## [v0.2.0] - 2026-07-30

### 新增
- **物品搜索 / 筛选**（服务端过滤）：关键词、状态、分类、位置四维组合查询
  - 后端 `GET /api/items` 新增 `keyword` / `status_filter` / `category_id` / `location_id` 查询参数
  - 前端新增筛选栏（`#filter-bar`），含搜索框、状态 / 分类 / 位置下拉与一键重置
- **仪表盘增强**：
  - 概览新增「按分类统计」分布（原为仅按状态分布）
  - 「即将过期」提醒的天数阈值改为可调输入（默认 30 天）
- **测试**：`tests/test_items.py` 新增 `test_item_filter`，覆盖 keyword / status / category / location 过滤

### 优化
- 筛选走 URL 查询串（`URLSearchParams`），刷新 / 分享链接可复现当前筛选条件
- 列表默认按创建时间倒序，最新录入排在前面

### 已知限制（更新）
- 位置选择仍为 ID 下拉，未做可视化树选择器（计划 v0.3）
- 无批量导入导出（计划 v0.4）

---

## [v0.1.0] - 2026-07-30

### 新增
- 项目骨架与 Docker 部署（`Dockerfile` + `docker-compose.yml` + `.env.example`）
- 多用户注册 / 登录（JWT 鉴权，数据按 `owner_id` 隔离）
- 物品 CRUD：名称、描述、数量、单位、**状态**、**保质期**、购买日期、位置、分类
- 位置**层级树**（`parent_id` 自引用）+ 自由备注；删除父级时子级自动提升一级
- 分类 / 标签（带颜色）
- 概览统计（总数、按状态分布）+ 近 30 天即将过期提醒
- 完整项目文档：导航 README + 功能 / 更新日志 / 踩坑 / 部署 / 开发 / 安卓规划
- 基础测试：`tests/test_auth.py`、`tests/test_items.py`

### 已知限制
- 无刷新令牌：JWT 过期（默认 1 天）需重新登录
- 位置选择在前端用 ID 下拉，未做可视化树选择器（计划 v0.3）
- 无批量导入导出（计划 v0.4）
- 单文件 SQLite，未做并发写优化（家庭/小团队场景足够）
