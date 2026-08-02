// 物品视图编排器：加载元数据 + 渲染主模板 + 组装 ctx + 初始化子模块
// 子模块：items-list.js（列表/筛选/CSV）、items-form.js（表单/编辑）、items-batch.js（批量）
import { api } from "./api.js";
import { buildTreeOptions, escapeHtml, viewError, viewLoading } from "./utils.js";
import { initBatch } from "./items-batch.js";
import { initForm } from "./items-form.js";
import { initList } from "./items-list.js";

// 状态字典：由后端 /api/meta 提供（单一数据源），此处为离线兜底值
let STATUS_OPTIONS = ["在库", "已借出", "损坏", "待处理", "已丢弃", "已清理"];

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
      <form id="item-form" class="card">
        <input name="name" placeholder="物品名称" required />
        <input name="description" placeholder="描述" />
        <select name="location_id">
          ${buildTreeOptions(locations, "位置（可选）")}
        </select>
        <input name="location_note" placeholder="备注位置" />
        <select name="category_id">
          <option value="">分类（可选）</option>
          ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
        <input name="quantity" type="number" step="any" value="1" placeholder="数量" />
        <input name="unit" value="个" placeholder="单位" />
        <select name="status">
          ${STATUS_OPTIONS.map((s) => `<option>${s}</option>`).join("")}
        </select>
        <input name="expiry_date" type="date" title="保质期" />
        <input name="purchase_date" type="date" title="购买日期" />
        <input name="serial_number" placeholder="序列号" />
        <input name="price" type="number" step="0.01" placeholder="价格" title="价格（元）" />
        <input name="warranty_expiry" type="date" title="保修到期" />
        <select name="tags" multiple size="3" title="标签（按住 Ctrl 多选）">
          <option value="">标签…</option>
          ${tags.map((t) => `<option value="${t.id}" style="color:${t.color}">${escapeHtml(t.name)}</option>`).join("")}
        </select>
        <div class="photo-pick" id="item-photo-pick">
          <label class="photo-opt" id="item-photo-camera-label">
            <input id="item-photo-camera" type="file" accept="image/*" capture="environment" />
            <span>拍照</span>
          </label>
          <label class="photo-opt" id="item-photo-gallery-label">
            <input id="item-photo-gallery" type="file" accept="image/*" />
            <span>图库</span>
          </label>
          <p class="photo-hint">照片会自动压缩为 WebP（≤2000px）</p>
        </div>
        <img id="item-photo-preview" class="photo-preview hidden" alt="照片预览" />
        <button type="submit">添加</button>
      </form>

      <div id="filter-bar" class="card">
        <input id="f-keyword" placeholder="搜索名称/描述/备注…" />
        <select id="f-status">${statusOpts}</select>
        <select id="f-category">${catOpts}</select>
        <select id="f-location">${locOpts}</select>
        <select id="f-tag">${tagOpts}</select>
        <button id="f-search" type="button">搜索</button>
        <button id="f-reset" type="button" class="ghost">重置</button>
        <button id="export-csv" type="button" class="ghost" style="margin-left:auto">导出 CSV</button>
        <button id="import-csv" type="button" class="ghost">导入 CSV</button>
        <input id="import-file" type="file" accept=".csv" style="display:none" />
        <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:4px">
          <input id="f-archived" type="checkbox" /> 显示已归档
        </label>
      </div>

      <div id="item-list"></div>
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
      editingItemId: null, // 编辑中物品 id（null = 新增模式）
      loadItems: null, // 由 initList 注入
      startEdit: null, // 由 initForm 注入（列表行 [data-edit] 分派）
      bindBatch: null, // 由 initBatch 注入（列表重渲染后调用）
    };

    // 初始化子模块（表单/编辑、批量、列表/筛选/CSV + 初次加载）
    initForm(ctx);
    initBatch(ctx);
    initList(ctx);
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}
