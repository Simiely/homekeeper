// 物品视图编排器：加载元数据 + 渲染主模板 + 组装 ctx + 初始化子模块
// 子模块：items-list.js（列表/筛选/CSV）、items-form.js（表单/编辑）、items-batch.js（批量）
import { api } from "./api.js";
import { buildTreeOptions, escapeHtml, viewError, viewLoading } from "./utils.js";
import { initList } from "./items-list.js";

// 状态字典：由后端 /api/meta 提供（单一数据源），此处为离线兜底值
let STATUS_OPTIONS = ["在库", "已借出", "损坏", "待处理", "已丢弃"];

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
      startEdit: null, // 由本文件注入（列表行 [data-edit] 分派）
    };
    ctx.startEdit = (item) => startEdit(item);

    // ===== 编辑模式（表单职责，Step 2 将迁移到 items-form.js）=====
    function startEdit(item) {
      ctx.editingItemId = item.id;
      const form = el.querySelector("#item-form");
      form.querySelector("[name=name]").value = item.name || "";
      form.querySelector("[name=description]").value = item.description || "";
      form.querySelector("[name=location_id]").value = item.location_id ?? "";
      form.querySelector("[name=location_note]").value = item.location_note || "";
      form.querySelector("[name=category_id]").value = item.category_id ?? "";
      form.querySelector("[name=quantity]").value = item.quantity;
      form.querySelector("[name=unit]").value = item.unit || "";
      form.querySelector("[name=status]").value = item.status || "在库";
      form.querySelector("[name=expiry_date]").value = item.expiry_date || "";
      form.querySelector("[name=purchase_date]").value = item.purchase_date || "";
      form.querySelector("[name=serial_number]").value = item.serial_number || "";
      form.querySelector("[name=price]").value = item.price ?? "";
      form.querySelector("[name=warranty_expiry]").value = item.warranty_expiry || "";
      const btn = form.querySelector("button[type=submit]");
      btn.textContent = "保存";
      if (!form.querySelector("#edit-cancel")) {
        const cancel = document.createElement("button");
        cancel.id = "edit-cancel";
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.className = "ghost";
        cancel.onclick = cancelEdit;
        btn.after(cancel);
      }
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function cancelEdit() {
      ctx.editingItemId = null;
      const form = el.querySelector("#item-form");
      form.reset();
      form.querySelector("button[type=submit]").textContent = "添加";
      const cancel = form.querySelector("#edit-cancel");
      if (cancel) cancel.remove();
    }

    // ===== 新增/编辑提交 =====
    el.querySelector("#item-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const tagSelect = el.querySelector("[name=tags]");
        const selectedTags = tagSelect ? Array.from(tagSelect.selectedOptions).map(o => o.value).filter(v => v) : [];

        let itemId;
        if (ctx.editingItemId) {
          await api.put(`/items/${ctx.editingItemId}`, buildPayload(fd));
          itemId = ctx.editingItemId;
          const current = await api.get(`/items/${itemId}`);
          const removeTags = (current.tags || []).map((t) => t.id).filter((id) => !selectedTags.includes(String(id)));
          for (const tid of removeTags) {
            await api.del(`/items/${itemId}/tags/${tid}`);
          }
        } else {
          const created = await api.post("/items", buildPayload(fd));
          itemId = created.id;
        }
        // 新增标签（已存在跳过）
        for (const tid of selectedTags) {
          try {
            await api.post(`/items/${itemId}/tags/${tid}`);
          } catch {
            // 标签已存在则忽略
          }
        }
        cancelEdit();
        ctx.loadItems();
      } catch (err) {
        alert("保存失败：" + err.message);
      }
    };

    // 初始化子模块（列表/筛选/CSV + 初次加载）
    initList(ctx);
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}

function buildPayload(fd) {
  const p = {
    name: fd.get("name"),
    description: fd.get("description") || "",
    location_note: fd.get("location_note") || "",
    quantity: Number(fd.get("quantity")) || 1,
    unit: fd.get("unit") || "个",
    status: fd.get("status") || STATUS_OPTIONS[0] || "在库",
    expiry_date: fd.get("expiry_date") || null,
    purchase_date: fd.get("purchase_date") || null,
    serial_number: fd.get("serial_number") || null,
    price: fd.get("price") ? Number(fd.get("price")) : null,
    warranty_expiry: fd.get("warranty_expiry") || null,
  };
  const lid = fd.get("location_id");
  const cid = fd.get("category_id");
  if (lid) p.location_id = Number(lid);
  if (cid) p.category_id = Number(cid);
  return p;
}
