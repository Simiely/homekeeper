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
      .concat(buildTreeOptions(locations))
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
        if (editingItemId) {
          await api.put(`/items/${editingItemId}`, buildPayload(fd));
          cancelEdit();
        } else {
          await api.post("/items", buildPayload(fd));
        }
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

    // ---- 编辑模式 ----
    let editingItemId = null;

    function startEdit(item) {
      editingItemId = item.id;
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
      // 修改提交按钮
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
      // 滚动到表单
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function cancelEdit() {
      editingItemId = null;
      const form = el.querySelector("#item-form");
      form.reset();
      form.querySelector("button[type=submit]").textContent = "添加";
      const cancel = form.querySelector("#edit-cancel");
      if (cancel) cancel.remove();
    }

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

      const parentMap = Object.fromEntries(locations.map((l) => [l.id, l.parent_id]));
      const nameMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
      const locPath = (id) => {
        if (!id) return null;
        const parts = [];
        let cur = id;
        while (cur && nameMap[cur]) {
          parts.unshift(nameMap[cur]);
          cur = parentMap[cur];
        }
        return parts.join(" > ");
      };
      const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

      // 并发获取所有物品的图片（取第一张）
      const imgMap = {}; // item_id -> {filename, ...}
      await Promise.all(
        items.map(async (it) => {
          try {
            const imgs = await api.get(`/items/${it.id}/images`);
            if (imgs.length > 0) imgMap[it.id] = imgs[0];
          } catch {
            // 静默失败，不阻塞列表渲染
          }
        })
      );

      const rows = items
        .map(
          (it) => {
            const img = imgMap[it.id];
            const imgCell = img
              ? `<div class="thumb-wrap" data-img="/api/images/${img.filename}" title="点击放大">
                   <img src="/api/images/${img.filename}" alt="" loading="lazy" />
                 </div>`
              : `<button class="upload-btn" data-upload-item="${it.id}" title="上传图片">+</button>`;
            return `
        <tr>
          <td>${escapeHtml(it.name)}</td>
          <td>${locPath(it.location_id) || "—"}${
              it.location_note ? " (" + escapeHtml(it.location_note) + ")" : ""
            }</td>
          <td>${catMap[it.category_id] || "—"}</td>
          <td>${it.quantity} ${escapeHtml(it.unit)}</td>
          <td>${escapeHtml(it.status)}</td>
          <td>${it.expiry_date || "—"}</td>
          <td style="text-align:center">${imgCell}</td>
          <td style="white-space:nowrap">
            <button data-edit="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px">编</button>
            <button data-del="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--danger);padding:4px 8px;border-radius:6px;font-size:12px">删</button>
          </td>
        </tr>`;
          }
        )
        .join("");

      listEl.innerHTML = `
        <p class="muted">共 ${items.length} 件</p>
        <table class="list">
          <thead><tr><th>名称</th><th>位置</th><th>分类</th><th>数量</th><th>状态</th><th>保质期</th><th>图片</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted">无匹配物品</td></tr>'}</tbody>
        </table>
      `;

      // 上传图片（事件委托）
      listEl.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-upload-item]");
        if (!btn) return;
        const itemId = btn.dataset.uploadItem;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (!file) return;
          btn.classList.add("uploading");
          btn.textContent = "…";
          try {
            const form = new FormData();
            form.append("file", file);
            await api.upload(`/items/${itemId}/images`, form);
            loadItems();
          } catch (err) {
            alert("上传失败: " + err.message);
            btn.classList.remove("uploading");
            btn.textContent = "+";
          }
        });
        input.click();
      });

      // 图片点击放大（事件委托）
      listEl.addEventListener("click", (e) => {
        const wrap = e.target.closest("[data-img]");
        if (!wrap) return;
        const src = wrap.dataset.img;
        const overlay = document.createElement("div");
        overlay.className = "img-overlay";
        overlay.innerHTML = `<img src="${src}" alt="" />`;
        overlay.onclick = () => overlay.remove();
        document.body.appendChild(overlay);
      });

      // 操作按钮（编辑/删除）事件委托
      listEl.addEventListener("click", (e) => {
        // 编辑
        const editBtn = e.target.closest("[data-edit]");
        if (editBtn) {
          const itemId = Number(editBtn.dataset.edit);
          const item = items.find((it) => it.id === itemId);
          if (item) startEdit(item);
          return;
        }
        // 删除
        const delBtn = e.target.closest("[data-del]");
        if (delBtn) {
          if (!confirm("确认删除？")) return;
          api.del(`/items/${delBtn.dataset.del}`).then(() => loadItems());
        }
      });
    }
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

// ---- 位置树辅助（用于缩进下拉） ----

function buildLocTree(locations) {
  const lookup = {};
  locations.forEach((l) => (lookup[l.id] = { ...l, children: [] }));
  const roots = [];
  locations.forEach((l) => {
    if (l.parent_id === null) roots.push(lookup[l.id]);
    else if (lookup[l.parent_id]) lookup[l.parent_id].children.push(lookup[l.id]);
  });
  return roots;
}

function buildTreeOptions(locations, placeholder) {
  const tree = buildLocTree(locations);
  let html = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const prefix = depth > 0 ? "　".repeat(depth) + "├── " : "";
      html += `<option value="${node.id}">${prefix}${escapeHtml(node.name)}</option>`;
      if (node.children.length) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return html;
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
