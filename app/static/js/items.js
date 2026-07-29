// 物品视图：列表 + 新增 + 删除（关联位置/分类/状态/保质期）
import { api } from "./api.js";

const STATUS_OPTIONS = ["在库", "已借出", "损坏", "待处理", "已丢弃"];

export async function renderItems() {
  const el = document.getElementById("view-items");
  el.innerHTML = "<h2>物品</h2><div class='loading'>加载中…</div>";
  try {
    const [items, locations, categories] = await Promise.all([
      api.get("/items"),
      api.get("/locations"),
      api.get("/categories"),
    ]);
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

    el.innerHTML = `
      <h2>物品</h2>
      <form id="item-form" class="card">
        <input name="name" placeholder="物品名称" required />
        <input name="description" placeholder="描述" />
        <select name="location_id">
          <option value="">位置（可选）</option>
          ${locations
            .map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`)
            .join("")}
        </select>
        <input name="location_note" placeholder="备注位置" />
        <select name="category_id">
          <option value="">分类（可选）</option>
          ${categories
            .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
            .join("")}
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
      <table class="list">
        <thead><tr><th>名称</th><th>位置</th><th>分类</th><th>数量</th><th>状态</th><th>保质期</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    el.querySelector("#item-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.post("/items", buildPayload(fd));
        renderItems();
      } catch (err) {
        alert(err.message);
      }
    };

    el.querySelectorAll("button[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确认删除？")) return;
        await api.del(`/items/${b.dataset.del}`);
        renderItems();
      };
    });
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
