# items.js 拆分计划（2026-08-02）

> 背景：items.js 557 行，`renderItems` 巨型函数占 9-537 行，混合 10 类职责。为避免后续加功能更臃肿，拆分为职责单一的多文件模块。
> 目标：最大文件 < 200 行；每个文件职责单一；复用已验证的「ctx 注入」模式（同 locations-drag.js 的 hooks 模式）。

---

## 一、现状分析

### 1.1 文件结构（557 行）

| 行范围 | 职责块 | 行数 |
|--------|--------|------|
| 9-84 | 元数据加载（locations/categories/tags/meta）+ 主模板渲染（筛选栏/表单/列表容器/批量条） | ~76 |
| 85-186 | **列表事件委托**：图片上传、缩略图 overlay、归档/删除、编辑按钮分派 | ~102 |
| 187-221 | 新增表单提交（`#item-form` onsubmit） | ~35 |
| 222-240 | 筛选栏：doSearch / f-search / f-reset / 各下拉 onchange | ~19 |
| 242-271 | CSV 导入导出 | ~30 |
| 273-334 | 编辑模式：startEdit / cancelEdit（回填表单） | ~62 |
| 335-355 | renderPagination（分页条） | ~21 |
| 356-470 | **loadItems**（读筛选 → 请求 → 渲染行 + 分页） | ~115 |
| 474-537 | 批量操作条：updateBatchBar / select-all / batch-* 按钮 | ~64 |
| 538-557 | buildPayload（表单序列化） | ~20 |

### 1.2 关键耦合点

- **loadItems 被 13 处调用**：所有操作（表单提交/筛选/批量/归档/删除/翻页/图片上传）后都刷新列表——它是模块间的"总线"
- **共享状态**：`items`（当前页数据）、`currentPage`（页码）、`editingItemId`（编辑中物品）都在 renderItems 函数内
- **编辑按钮分派**：列表行内 `[data-edit]` 按钮 → startEdit（属于 form 职责）；归档/删除 → 直接 api + loadItems（属于 list 职责）

---

## 二、目标结构（4 文件）

```
js/
├── items.js          # 入口编排（~130 行）：元数据加载 + 主模板 + ctx 组装 + 初次加载
├── items-list.js     # 列表（~210 行）：loadItems / renderPagination / 行模板 / 列表事件委托（图片/归档/删除）/ 筛选栏 / CSV 导入导出
├── items-form.js     # 表单（~110 行）：新增提交 / startEdit / cancelEdit / buildPayload
└── items-batch.js    # 批量（~80 行）：批量条 / updateBatchBar / select-all / batch-* 按钮
```

### 2.1 各文件职责明细

| 文件 | 导出 | 职责 |
|------|------|------|
| **items.js** | `renderItems()` | 加载元数据；渲染主模板（筛选栏+表单+列表容器+批量条容器）；创建并填充 `ctx`；调用 `initList/initForm/initBatch` 完成绑定；初次 `loadItems` |
| **items-list.js** | `initList(ctx)` | 绑定 `#item-list` 事件委托（图片上传/缩略图/归档/删除/[data-edit] 分派）；`loadItems(ctx)`；`renderPagination(ctx, d)`；**筛选栏绑定（doSearch/f-search/f-reset/各下拉）**；**CSV 导入导出**（与列表数据强相关） |
| **items-form.js** | `initForm(ctx)` | `#item-form` 提交（新建/编辑共用，editId 由 ctx 持有）；`startEdit(ctx, item)` / `cancelEdit(ctx)`；`buildPayload(fd)` |
| **items-batch.js** | `initBatch(ctx)` | 批量条绑定：`select-all`、勾选更新、`batch-archive/delete/status/category`；`updateBatchBar(ctx)` |

> 优化点（调研后确认）：筛选栏与 CSV 导入导出归属 items-list.js——它们都与"列表数据"强相关（筛选驱动 loadItems、CSV 导出当前列表/导入刷新列表），放 list 模块内聚性更好，编排器保持最薄。

### 2.2 模块间通信：ctx 状态对象

```js
// items.js 内创建（单一数据源，各模块读写同一对象）
const ctx = {
  el,                    // #view-items 容器
  locations, categories, tags, catMap,
  items: [],             // 当前页物品（loadItems 填充）
  currentPage: 1,
  editingItemId: null,   // 编辑中物品 id（null = 新增模式）
  loadItems: null,       // 由 initList 注入（表单/批量提交后调用）
};
```

- 依赖方向：`items.js → items-list/form/batch`（单向，无环）
- `loadItems` 由 list 模块注入 ctx，form/batch 只调 `ctx.loadItems()`——与 locations-drag.js 的 hooks 模式一致
- 筛选值不存 ctx，**读 DOM**（`#f-keyword` 等），保持单数据源简单

---

## 三、执行步骤（4 步，每步独立验证）

| 步骤 | 动作 | 验证点 |
|------|------|--------|
| **1** | 新建 `items-list.js`：迁移 loadItems/renderPagination/行模板/列表事件委托（含归档/删除/图片/编辑分派），导出 `initList(ctx)` | 列表渲染、翻页、筛选、归档/删除、图片上传、编辑按钮弹表单 |
| **2** | 新建 `items-form.js`：迁移表单提交/startEdit/cancelEdit/buildPayload，导出 `initForm(ctx)` | 新增物品、编辑回填保存、取消编辑 |
| **3** | 新建 `items-batch.js`：迁移批量条，导出 `initBatch(ctx)` | 勾选计数、全选、批量归档/删除/改状态/改分类 |
| **4** | 重写 `items.js` 为编排器（删 400+ 行），跑全量回归 | 上述全部 + 无 JS 错误 + 语法检查 |

### 每步验证方式
- `node --check` 语法
- 浏览器（430px 触屏）：登录 → 物品页 → 对应功能操作 → 无 pageerror
- 全部 4 步完成后跑一次完整回归（新增→筛选→编辑→批量→导出）

---

## 四、风险与对策

| 风险 | 对策 |
|------|------|
| loadItems 闭包变量丢失（items/currentPage） | 全部收敛进 ctx，模块函数显式读 `ctx.xxx` |
| 事件委托重复注册（上次 P0 教训） | 委托只在 initList 注册一次（#item-list 常驻节点），重渲染只改 innerHTML |
| 编辑/表单状态跨模块（editingItemId） | 存 ctx，form 模块读写 |
| 图片 overlay / 导入导出逻辑 | 步骤 1 整体搬迁不重构（纯搬移），降低回归风险 |

---

## 五、拆分后预期

- items.js：557 → 约 150 行（编排器）
- 最大文件：items-list.js ~180 行
- 无文件超过 200 行
- 后续加功能（如"过期清理视图""物品详情页"）只需新增模块或往对应模块加，不再膨胀

---

## 六、执行结果（已完成）

| 步骤 | 提交 | 结果 |
|------|------|------|
| Step 1：items-list.js | a8f0299 | ✅ loadItems/分页/行模板/事件委托/筛选/CSV 迁出，items.js 557→202 行 |
| Step 2：items-form.js | a62cce9 | ✅ 表单提交/编辑回填/buildPayload 迁出，items.js 106 行 |
| Step 3：items-batch.js | 2c570ee | ✅ 批量条绑定迁出，items.js 109 行编排器 |

最终结构（4 文件，最大 316 行）：
```
items.js       109 行 编排器（元数据 + 主模板 + ctx 组装）
items-list.js  316 行 列表（loadItems/分页/行渲染/事件委托/筛选/CSV）
items-form.js  107 行 表单（提交/编辑回填/buildPayload）
items-batch.js  70 行 批量（勾选/全选/归档/删除/改状态/改分类）
```

**顺带修复（拆分验证中发现）**：
- **audit 写锁 P1 bug**：after_insert 等事件在业务事务 flush 阶段用新连接写日志 → SQLite database is locked → 物品写操作请求挂起。改用事件传入的 connection 同一事务写日志（a8f0299 内）
- **SQLite 并发加固**：connect timeout 30 + PRAGMA WAL/busy_timeout=30000（a8f0299 内）

验证：全量回归（新增/编辑/筛选/批量/删除/首页/位置/分类/标签/hash 路由）全过，pytest 11 passed（提速至 ~1.7s），无 JS 错误。
