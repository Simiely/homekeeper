# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循大致的语义化。

---

## [v0.9.3] - 2026-08-02

### 位置页交互改版（⭐ 重点）

#### 新增
- **改名只在编辑模式进行**：非编辑模式点击项目条 = **展开/收起该位置的物品列表**（原为 ▸ 箭头专属，现整条可点，除右侧 `+`/`✕` 按钮外）
- **编辑模式双操作**：**单击卡片 = 改名**（按下未拖动即判定为单击）、**拖动 = 调整层级**
- **提示文字常驻**：进入编辑模式后提示「编辑模式：单击卡片改名，拖动卡片调整层级」一直显示，直到点「✔ 完成」退出；被临时错误提示覆盖后自动恢复
- **触屏 Pointer 支持**：拖拽事件由 `mousedown/mousemove/mouseup` 改为 `pointerdown/move/up/cancel`（统一鼠标/触摸/触控笔），按下即锁定 `touch-action:none` + 捕获阶段阻止 `touchmove`，手机模拟/真实触屏可正常拖拽
- 「家」（id=1）可单击改名、但拖动仍被禁止（超阈值直接取消）

#### 修复
- 位置展开逻辑改用 `.expanded` 类判断（原用内联 `style.display` 判断导致首次点击永远无法展开的历史 bug）
- 改名表单输入框 + 保存/取消按钮强制一行布局（覆盖 768px 断点 `.card{flex-direction:column}` 的影响）

---

## [refactor] - 2026-08-02（未发版，代码已合入 master）

### 模块化梳理执行（详见 docs/09）

#### 阶段 1：P0 止血
- **修复 items.js 事件监听器累积**：3 个 `listEl.addEventListener("click")` 原注册在 `loadItems()` 内（被调用 15 次），翻页/筛选后点删除会弹出多个 confirm、点缩略图叠加多层遮罩 → 合并为 1 个顶层事件委托（`data-*` 分派），监听器只注册一次
- 清理 backups.js：本地重复定义的 `escapeHtml` 改为从 utils.js 导入；移除未使用的 `getToken`

#### 阶段 2：后端 services 层下沉
- 新增 5 个 service：`item_service` / `location_service` / `dashboard_service` / `image_service` / `data_service`
- 5 个 fat router 变薄壳（items/locations/dashboard/images/data）：**合计 1839 → 477 行（-74%）**
- 服务层抛领域异常（`ItemNotFoundError` / `LocationInvalidError` 等），router 捕获转 HTTP 响应，解除服务层对 FastAPI 的依赖
- 批量删除物品同步清理磁盘图片目录（与单删一致，修复资源泄漏）
- **修复原有 bug**：仪表盘按分类汇总金额时 `sum()` 可能为 NULL（存在无价格物品）→ `coalesce(..., 0.0)` 兜底
- 验证：pytest 11 passed + 无头浏览器 8 视图回归 + 位置页交互回归

#### 阶段 3（待执行）
- app.js 拆分 push.js、items.js 拆分、收编内联小字（见 docs/09）

---

## [v0.9.2] - 2026-08-01

### 位置页交互重构（⭐ 重点）

#### 新增
- **「编辑」模式开关**：位置页右上角新增「✎ 编辑」按钮 → 进入拖拽模式（按钮变「✔ 完成」），再点退出
  - v0.9.2 默认模式：点击卡片 = 内联改名（v0.9.3 起改为仅编辑模式内单击改名）
  - 编辑模式：卡片鼠标变抓取手势、手柄高亮，**按住卡片拖动调整层级**
  - 拖拽目标识别：鼠标【上下】确定缝隙（选择区域实时跟随），区域内【左=与上方条目同级 / 右=成为子级】，松手放置自动保存
  - 「家」（id=1）固定根：不可拖拽、不可删除，仅可添加子项目（"同级"选项灰显禁用）
- **位置卡片显示物品数量**：不再显示子位置数，改为「N 件物品」；点 ▸ 箭头展开/收起该位置的物品列表（名称 ×数量 + 状态）
- **取消顶部添加表单**：添加子位置统一走卡片右侧 `+` 按钮（内联表单）

#### 落位动画（多轮打磨）
- 松手后**间距先收回 → 卡片从正右方水平滑入空隙（0.5s）→ 静默保存**（无后续动画）
- 滑入占位尺寸 = 卡片实际高度（精准预留）；定格位置微调对齐（上移 4px）
- 拖拽中文字不产生蓝色选中（`user-select: none`）；按钮不触发 hover 高亮
- 间距拉开/收回过渡 0.2s；主色调按钮深色模式文字色改为深棕 `#462828`

#### 前端调试基建（⭐ 重点）
- **无头浏览器自动化调试**（Edge + CDP，puppeteer-core）：真实打开页面、模拟登录/点击/拖拽、抓取 Console 异常与 4xx、自动截图、读取 DOM 状态
- 脚本入库：`browser_debug/`（basic_check / drag_test / drag_precise_test / drag_gap_test / edit_mode_test）
- 文档：`docs/05-开发指南.md` 新增「无头浏览器自动化调试（Edge + CDP）⭐ 重点」章节（技术选型 / 启动 / API 速查 / 踩坑 / 工作流）

#### 修复
- 拖拽目标识别：改用 `elementFromPoint` 命中最深层卡片（修复 li 嵌套导致永远选中最外层「家」的 bug）
- 缝隙"上方对象"计算改用 `.loc-head` 矩形（修复含子级卡片底部偏移导致的目标识别错误）
- 拖拽中新建的空子级容器统一清理；取消拖拽不再误删被拖卡片原有子级
- 滑入动画期间保持间距拉开（修复动画结束"下方整体上提"）

---

## [v0.9.1] - 2026-08-01

### 安全清理（⭐ 重点）
- **移除默认管理员密码**：`config.py` 默认值清空，改由 `DEFAULT_ADMIN_PASSWORD` 环境变量指定；未设置则首次启动随机生成并打印在日志
- README / 部署指南 / 开发指南 / 更新日志全部移除明文 `admin / Mm123456.`，统一标注"部署时自行设置强密码"
- 测试注入独立测试密码（`TestAdminPass123!`），与生产隔离
- 仓库明文密码扫描清零；`.env.example` 补充 `DEFAULT_ADMIN_PASSWORD` 说明

---

## [v0.9.0] - 2026-08-01

### 模块化重构（⭐ 重点）

#### 架构分层
- **路由全部收敛到 `routers/`**：新增 `routers/backup.py`（备份 API）、`routers/meta.py`（`GET /api/meta` 状态字典单源）
- **`services/` 纯业务层**：新增 `services/scheduler.py`（统一调度器编排）、`services/push_scheduler.py`（推送调度），消除 `services` 对 `routers` 的反向依赖
- `schemas/__init__.py` 导出补全；日期类型统一（非法日期返回 422 而非 500）
- 删除用户时资源**转交管理员**（不再因外键约束 500）

#### 安全修复（P0）
- **图片接口越权（IDOR）**：`/api/images/*` 与二维码接口加鉴权（header + `?token=` 双通道，供 `<img>` 使用）+ 物品归属校验
- **备份接口鉴权**：列表需登录，触发/恢复仅管理员（原完全无鉴权）
- **概览页崩溃**：`dashboard.js` 用 `for...of` 遍历分页对象 → 改为取 `.items`
- **导出 CSV 失效**：`window.open` 无凭证 → 改为 fetch + blob 下载（`api.download()`）
- **双重日志**：移除 items 手动写日志（保留事件监听），SQLite 开启外键约束

#### 状态与数据统一
- `GET /api/meta` 提供状态字典单源（前端不再硬编码状态值）
- dashboard 聚合改 SQL `GROUP BY`（顺带修复 price=0 不计入资产的 bug）
- CSV 导出逻辑去重（两个导出端点复用同一生成函数）；CSV 导入逐行事务（失败只回滚本行）

#### 加固
- SQLite 路径解析兜底（不依赖启动目录）；`_migrate_sqlite()` 轻量迁移（加列自动补）
- 全局异常处理器（未捕获异常记录日志）；管理员密码入配置
- 前端：items.js 拆分出 `item-dialogs.js`（弹窗模块）；树构建/加载/错误模板收敛到 utils

#### 导航改造（方案 1）
- 顶栏改为 `概览 | 物品 | 位置 | 分类 | 标签 ｜ 设置▾`（下拉：用户管理 / 数据备份，仅管理员可见）
- 导航调度数据化：统一 `showView()` + 父项联动高亮，功能模块零改动

---

## [v0.8.0] - 2026-07-30

### 品牌升级
- **更名为「拾光集」**（原物管家），标语「家里的每一物，都值得被记住」
- 登录页重设计为玻璃拟态（glassmorphism）：居家背景图 + 高斯模糊卡片 + 装饰光晕 + 入场动画
- 登录页底部显示实时日期时间（两行排版：上时间下日期）
- 更新 PWA manifest.json / Service Worker 品牌名

### 新增
- **管理员系统**：User 模型新增 `is_admin` 布尔字段
- **默认管理员**：首次启动自动 seed 账户 `admin`（密码由 `DEFAULT_ADMIN_PASSWORD` 环境变量指定，未设置则随机生成并打印在日志）
- **管理员 API**：`app/routers/admin.py` — 查看用户列表 / 创建用户 / 删除用户
- **管理前端页**：顶部导航「管理」按钮仅管理员可见；管理页支持添加/删除用户
- **管理员依赖**：`deps.py` 新增 `get_admin_user`，403 返回非管理员
- **深/浅色主题系统**：CSS 变量双主题 + 背景图切换 + 防闪烁内联脚本 + localStorage 持久化
- **主题切换按钮**：登录页浮动圆形按钮 + 主页面顶栏按钮
- **响应式适配**：三断点（900px / 768px / 480px），顶栏横向滚动、卡片纵向堆叠、表格可滑动
- **`theme.js`**：独立主题管理模块，导出 `getTheme/setTheme/toggleTheme`

### 变更
- **关闭公开注册**：移除 `POST /api/auth/register` 端点，用户创建仅限管理员操作
- 登录页删除注册选项卡，仅保留登录表单
- 登录页底部提示文字改为日期时间

### 修复
- 本地开发：代码中 `/app/data/` 硬编码路径全部替换为基于项目根目录的相对路径（7 处）
- **浏览器自动填充白底**：使用 `transition-delay: 99999s` 冻结 Chrome autofill 颜色变化，
  配合 JS 定时兜底清除 box-shadow，输入框保持透明玻璃质感
- **推送按钮不可点击**：重写 `initPush()`，按钮始终可点击，点击后重试失败步骤
- 浅色模式玻璃效果增强：降低玻璃透明度、提高背景模糊
- 输入框深度透明：移除输入框底色，仅靠边框定义区域

### 依赖
- 无新增依赖

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
