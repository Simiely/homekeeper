// 物品视图编排器：筛选栏 + 紧凑列表 + 详情卡片（主-从布局）
// 子模块：items-list.js（列表/筛选/分页/批量/CSV）、items-detail.js（选中物品详情卡片）、items-batch.js（批量条）
// 添加/编辑物品统一走独立页面 #/add（add.js），顶栏 ＋ 进入
import { api } from "./api.js";
import { buildTreeOptions, escapeHtml, viewError, viewLoading } from "./utils.js";
import { initBatch } from "./items-batch.js";
import { initDetail } from "./items-detail.js";
import { initList } from "./items-list.js";

// 状态字典：由后端 /api/meta 提供（单一数据源），此处为离线兜底值
let STATUS_OPTIONS = ["在库", "临期", "定期处理", "已处理", "损坏丢弃"];

export async function renderItems() {
  const el = document.getElementById("view-items");
  el.innerHTML = viewLoading("物品");
  try {
    const [locations, categories, tags, meta] = await Promise.all([
      api.get("/locations"),
      api.get("/categories"),
      api.get("/tags"),
      api.get("/meta"),
    ]);
    // 用后端字典覆盖状态选项（新增状态只需改后端 models/status.py）
    if (meta?.statuses?.length) STATUS_OPTIONS = meta.statuses;

    const statusOpts = ['<option value="">全部状态</option>']
      .concat(STATUS_OPTIONS.map((s) => `<option value="${s}">${s}</option>`))
      .join("");
    const catOpts = ['<option value="">全部分类</option>']
      .concat(categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
      .join("");
    const locOpts = ['<option value="">全部位置</option>']
      .concat(buildTreeOptions(locations))
      .join("");
    const tagOpts = ['<option value="">全部标签</option>']
      .concat(tags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`))
      .join("");

    el.innerHTML = `
      <h2>物品</h2>
      <div id="filter-bar" class="card">
        <input id="f-keyword" placeholder="搜索名称/描述/备注…" />
        <select id="f-status">${statusOpts}</select>
        <select id="f-category">${catOpts}</select>
        <select id="f-location">${locOpts}</select>
        <select id="f-tag">${tagOpts}</select>
        <button id="f-search" type="button">搜索</button>
        <button id="f-reset" type="button" class="ghost">重置</button>
        <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:4px">
          <input id="f-archived" type="checkbox" /> 显示已处理
        </label>
        <button id="export-csv" type="button" class="ghost" style="margin-left:auto">导出 CSV</button>
        <button id="import-csv" type="button" class="ghost">导入 CSV</button>
        <input id="import-file" type="file" accept=".csv" style="display:none" />
      </div>

      <div class="items-layout">
        <div class="items-pane-list">
          <div id="item-list"></div>
        </div>
        <aside class="items-pane-detail" aria-label="物品详情">
          <div id="item-detail"></div>
        </aside>
      </div>
    `;

    // ===== 共享上下文（各子模块通过 ctx 读写，单一数据源）=====
    const ctx = {
      el,
      locations,
      categories,
      tags,
      statusOptions: STATUS_OPTIONS,
      items: [], // 当前页物品（loadItems 填充，事件委托读取）
      currentPage: 1,
      selectedId: null, // 选中的物品 id（详情卡片展示；?sel= 恢复）
      loadItems: null, // 由 initList 注入
      renderDetail: null, // 由 initDetail 注入（选中物品详情卡片）
      bindBatch: null, // 由 initBatch 注入（列表重渲染后调用）
    };

    // 初始化子模块（详情卡片、批量、列表/筛选/CSV + 初次加载）
    initDetail(ctx); // 先于 initList：ctx.renderDetail 需在 loadItems 前就绪
    initBatch(ctx);
    initList(ctx);
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}
