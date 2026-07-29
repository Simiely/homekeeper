// 物品视图：筛选 + 列表 + 新增 + 删除（关联位置/分类/状态/保质期）
import { api } from "./api.js";

const STATUS_OPTIONS = ["在库", "已借出", "损坏", "待处理", "已丢弃"];

export async function renderItems() {
  const el = document.getElementById("view-items");
  el.innerHTML = "<h2>物品</h2><div class='loading'>加载中…</div>";
  try {
    const [locations, categories] = await Promise.all([
      api.get("/locations"),
      api.get("/categories"),
    ]);

    const statusOpts = ['<option value="">全部状态</option>']
      .concat(STATUS_OPTIONS.map((s) => `<option value="${s}">${s}</option>`))
      .join("");
    const catOpts = ['<option value="">全部分类</option>']
      .concat(categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
      .join("");
    const locOpts = ['<option value="">全部位置</option>']
      .concat(locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`))
      .join("");

    el.innerHTML = `
      <h2>物品</h2>
      <form id="item-form" class="card">
        <input name="name" placeholder="物品名称" required />
        <input name="description" placeholder="描述" />
        <select name="location_id">
          <option value="">位置（可选）</option>
          ${locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("")}
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
        <button type="submit">添加</button>
      </form>

      <div id="filter-bar" class="card">
        <input id="f-keyword" placeholder="搜索名称…" />
        <select id="f-status">${statusOpts}</select>
        <select id="f-category">${catOpts}</select>
        <select id="f-location">${locOpts}</select>
        <button id="f-search" type="button">搜索</button>
        <button id="f-reset" type="button" class="ghost">重置</button>
      </div>

      <div id="item-list"></div>
    `;

    // 新增物品
    el.querySelector("#item-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.post("/items", buildPayload(fd));
        loadItems();
      } catch (err) {
        alert(err.message);
      }
    };

    // 筛选交互
    const doSearch = () => loadItems();
    el.querySelector("#f-search").onclick = doSearch;
    el.querySelector("#f-keyword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
    el.querySelector("#f-status").onchange = doSearch;
    el.querySelector("#f-category").onchange = doSearch;
    el.querySelector("#f-location").onchange = doSearch;
    el.querySelector("#f-reset").onclick = () => {
      el.querySelector("#f-keyword").value = "";
      el.querySelector("#f-status").value = "";
      el.querySelector("#f-category").value = "";
      el.querySelector("#f-location").value = "";
      loadItems();
    };

    // 初次加载列表
    loadItems();

    async function loadItems() {
      const listEl = el.querySelector("#item-list");
      listEl.innerHTML = "<div class='loading'>加载中…</div>";
      const params = new URLSearchParams();
      const kw = el.querySelector("#f-keyword").value.trim();
      const st = el.querySelector("#f-status").value;
      const ca = el.querySelector("#f-category").value;
      const lo = el.querySelector("#f-location").value;
      if (kw) params.set("keyword", kw);
      if (st) params.set("status_filter", st);
      if (ca) params.set("category_id", ca);
      if (lo) params.set("location_id", lo);
      const qs = params.toString();

      let items;
      try {
        items = await api.get("/items" + (qs ? "?" + qs : ""));
      } catch (e) {
        listEl.innerHTML = `<p class="err">${e.message}</p>`;
        return;
      }

      const locMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
      const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
      const rows = items
        .map(
          (it) => `
        <tr>
          <td>${escapeHtml(it.name)}</td>
          <td>${locMap[it.location_id] || "—"}${
            it.location_note ? " (" + escapeHtml(it.location_note) + ")" : ""
          }</td>
          <td>${catMap[it.category_id] || "—"}</td>
          <td>${it.quantity} ${escapeHtml(it.unit)}</td>
          <td>${escapeHtml(it.status)}</td>
          <td>${it.expiry_date || "—"}</td>
          <td><button data-del="${it.id}">删</button></td>
        </tr>`
        )
        .join("");

      listEl.innerHTML = `
        <p class="muted">共 ${items.length} 件</p>
        <table class="list">
          <thead><tr><th>名称</th><th>位置</th><th>分类</th><th>数量</th><th>状态</th><th>保质期</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">无匹配物品</td></tr>'}</tbody>
        </table>
      `;

      listEl.querySelectorAll("button[data-del]").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("确认删除？")) return;
          await api.del(`/items/${b.dataset.del}`);
          loadItems();
        };
      });
    }
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

function buildPayload(fd) {
  const p = {
    name: fd.get("name"),
    description: fd.get("description") || "",
    location_note: fd.get("location_note") || "",
    quantity: Number(fd.get("quantity")) || 1,
    unit: fd.get("unit") || "个",
    status: fd.get("status") || "在库",
    expiry_date: fd.get("expiry_date") || null,
    purchase_date: fd.get("purchase_date") || null,
  };
  const lid = fd.get("location_id");
  const cid = fd.get("category_id");
  if (lid) p.location_id = Number(lid);
  if (cid) p.category_id = Number(cid);
  return p;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
