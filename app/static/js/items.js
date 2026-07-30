// 物品视图：筛选 + 列表 + 新增 + 删除（关联位置/分类/状态/保质期）
import { api } from "./api.js";
import { buildTreeOptions, escapeHtml } from "./utils.js";

const STATUS_OPTIONS = ["在库", "已借出", "损坏", "待处理", "已丢弃"];

export async function renderItems() {
  const el = document.getElementById("view-items");
  el.innerHTML = "<h2>物品</h2><div class='loading'>加载中…</div>";
  try {
    const [locations, categories, tags] = await Promise.all([
      api.get("/locations"),
      api.get("/categories"),
      api.get("/tags"),
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

    // 新增物品
    el.querySelector("#item-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        // 提取标签（单值模式下 tags 以逗号分隔）
        const tagSelect = el.querySelector("[name=tags]");
        const selectedTags = tagSelect ? Array.from(tagSelect.selectedOptions).map(o => o.value).filter(v => v) : [];

        let itemId;
        if (editingItemId) {
          await api.put(`/items/${editingItemId}`, buildPayload(fd));
          itemId = editingItemId;
          // 清除旧标签（通过 API 获取当前标签）
          const current = await api.get(`/items/${itemId}`);
          if (current && current.tags) {
            for (const t of current.tags) {
              await api.del(`/items/${itemId}/tags/${t.id}`).catch(() => {});
            }
          }
        } else {
          const created = await api.post("/items", buildPayload(fd));
          itemId = created.id;
        }
        // 添加新标签
        for (const tagId of selectedTags) {
          await api.post(`/items/${itemId}/tags/${tagId}`).catch(() => {});
        }
        if (editingItemId) cancelEdit();
        loadItems();
      } catch (err) {
        alert(err.message);
      }
    };

    // 筛选交互
    const doSearch = () => { currentPage = 1; loadItems(); };
    el.querySelector("#f-search").onclick = doSearch;
    el.querySelector("#f-keyword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
    el.querySelector("#f-status").onchange = doSearch;
    el.querySelector("#f-category").onchange = doSearch;
    el.querySelector("#f-location").onchange = doSearch;
    el.querySelector("#f-tag").onchange = doSearch;
    el.querySelector("#f-archived").onchange = doSearch;
    el.querySelector("#f-reset").onclick = () => {
      el.querySelector("#f-keyword").value = "";
      el.querySelector("#f-status").value = "";
      el.querySelector("#f-category").value = "";
      el.querySelector("#f-location").value = "";
      el.querySelector("#f-tag").value = "";
      loadItems();
    };

    // 导出 CSV
    el.querySelector("#export-csv").onclick = () => {
      const token = localStorage.getItem("hk_token");
      if (!token) return;
      // 在新窗口下载，避免阻塞
      window.open(`/api/export/items?t=${Date.now()}`, "_blank");
    };

    // 导入 CSV
    const fileInput = el.querySelector("#import-file");
    el.querySelector("#import-csv").onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      try {
        const result = await api.upload("/import/items", form);
        let msg = `导入完成：${result.imported} 条成功`;
        if (result.errors?.length) {
          msg += `\n${result.errors.length} 条错误：\n${result.errors.slice(0, 5).join("\n")}`;
          if (result.errors.length > 5) msg += `\n…还有 ${result.errors.length - 5} 条`;
        }
        alert(msg);
        loadItems();
      } catch (e) {
        alert("导入失败：" + e.message);
      }
      fileInput.value = "";
    };

    // ---- 编辑模式 ----
    let editingItemId = null;
    let currentPage = 1;

    // 初次加载列表
    loadItems();

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
      form.querySelector("[name=serial_number]").value = item.serial_number || "";
      form.querySelector("[name=price]").value = item.price ?? "";
      form.querySelector("[name=warranty_expiry]").value = item.warranty_expiry || "";
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

    function renderPagination(d) {
      if (d.total_pages <= 1) return "";
      let html = '<div class="pagination">';
      const prevDisabled = d.page <= 1 ? "disabled" : "";
      html += `<button class="page-btn" data-page="${d.page - 1}" ${prevDisabled}>‹ 上一页</button>`;
      // 显示页码范围
      const start = Math.max(1, d.page - 2);
      const end = Math.min(d.total_pages, d.page + 2);
      if (start > 1) html += `<button class="page-btn" data-page="1">1</button>${start > 2 ? '<span class="page-ellipsis">…</span>' : ""}`;
      for (let p = start; p <= end; p++) {
        html += `<button class="page-btn" data-page="${p}"${p === d.page ? ' style="background:var(--accent);color:#fff;border-color:var(--accent)"' : ""}>${p}</button>`;
      }
      if (end < d.total_pages) {
        html += `${end < d.total_pages - 1 ? '<span class="page-ellipsis">…</span>' : ""}<button class="page-btn" data-page="${d.total_pages}">${d.total_pages}</button>`;
      }
      const nextDisabled = d.page >= d.total_pages ? "disabled" : "";
      html += `<button class="page-btn" data-page="${d.page + 1}" ${nextDisabled}>下一页 ›</button>`;
      html += "</div>";
      return html;
    }

    async function loadItems() {
      const listEl = el.querySelector("#item-list");
      listEl.innerHTML = "<div class='loading'>加载中…</div>";
      const params = new URLSearchParams();
      const kw = el.querySelector("#f-keyword").value.trim();
      const st = el.querySelector("#f-status").value;
      const ca = el.querySelector("#f-category").value;
      const lo = el.querySelector("#f-location").value;
      const ta = el.querySelector("#f-tag").value;
      if (kw) params.set("keyword", kw);
      if (st) params.set("status_filter", st);
      if (ca) params.set("category_id", ca);
      if (lo) params.set("location_id", lo);
      if (ta) params.set("tag_id", ta);
      if (el.querySelector("#f-archived").checked) params.set("show_archived", "true");
      params.set("page", currentPage);
      params.set("page_size", "20");
      const qs = params.toString();

      let data;
      try {
        data = await api.get("/items?" + qs);
      } catch (e) {
        listEl.innerHTML = `<p class="err">${e.message}</p>`;
        return;
      }
      const items = data.items;
      const total = data.total;
      const totalPages = data.total_pages;

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
              ? `<div class="thumb-wrap" data-img="/api/images/${img.item_id}/${img.filename}" title="点击放大">
                   <img src="/api/images/${img.item_id}/${img.filename}" alt="" loading="lazy" />
                 </div>`
              : `<button class="upload-btn" data-upload-item="${it.id}" title="上传图片">+</button>`;
            return `
        <tr${it.archived ? ' class="archived"' : ""}>
          <td><input type="checkbox" class="item-cb" value="${it.id}" /></td>
          <td>${escapeHtml(it.name)}</td>
          <td>${locPath(it.location_id) || "—"}${
              it.location_note ? " (" + escapeHtml(it.location_note) + ")" : ""
            }</td>
          <td>${catMap[it.category_id] || "—"}</td>
          <td>${it.quantity} ${escapeHtml(it.unit)}</td>
          <td>${it.price ? '¥' + it.price.toFixed(2) : "—"}</td>
          <td>${escapeHtml(it.status)}</td>
          <td>${it.expiry_date || "—"}</td>
          <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(it.serial_number || "") || "—"}</td>
          <td>${it.warranty_expiry || "—"}</td>
          <td>${(it.tags || []).map(t => `<span class="tag-chip" style="background:${t.color}20;color:${t.color};border-color:${t.color}60">${escapeHtml(t.name)}</span>`).join(" ") || "—"}</td>
          <td style="text-align:center">${imgCell}</td>
          <td style="white-space:nowrap">
            <button data-edit="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px">编</button>
            <button data-borrow="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 8px;border-radius:6px;font-size:12px" title="借用记录">借</button>
            <button data-qr="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 8px;border-radius:6px;font-size:12px" title="二维码">◈</button>
            ${it.archived
              ? `<button data-unarchive="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 8px;border-radius:6px;font-size:12px">取消归档</button>`
              : `<button data-archive="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 8px;border-radius:6px;font-size:12px">归档</button>`}
            <button data-del="${it.id}" style="background:transparent;border:1px solid var(--border);color:var(--danger);padding:4px 8px;border-radius:6px;font-size:12px">删</button>
          </td>
        </tr>`;
          }
        )
        .join("");

      listEl.innerHTML = `
        <p class="muted">共 ${total} 件 · 第 ${data.page}/${totalPages} 页</p>
        <table class="list">
          <thead><tr><th style="width:32px"><input type="checkbox" id="select-all" /></th><th>名称</th><th>位置</th><th>分类</th><th>数量</th><th>价格</th><th>状态</th><th>保质期</th><th>序列号</th><th>保修</th><th>标签</th><th>图片</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="13" class="muted">无匹配物品</td></tr>'}</tbody>
        </table>
        <div id="batch-bar" class="batch-bar" style="display:none">
          <span id="batch-count" class="muted" style="margin-right:8px">已选 0 件</span>
          <select id="batch-status"><option value="">改状态</option>${STATUS_OPTIONS.map(s => `<option value="${s}">${s}</option>`).join("")}</select>
          <select id="batch-category"><option value="">改分类</option>${categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
          <button id="batch-archive" class="ghost" style="font-size:12px">归档</button>
          <button id="batch-delete" class="ghost" style="font-size:12px;color:var(--danger)">删除</button>
        </div>
        ${renderPagination(data)}
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

      // 操作按钮（编辑/删除/翻页）事件委托
      listEl.addEventListener("click", (e) => {
        // 翻页
        const pageBtn = e.target.closest("[data-page]");
        if (pageBtn) {
          if (pageBtn.disabled) return;
          currentPage = Number(pageBtn.dataset.page);
          loadItems();
          return;
        }
        // 编辑
        const editBtn = e.target.closest("[data-edit]");
        if (editBtn) {
          const itemId = Number(editBtn.dataset.edit);
          const item = items.find((it) => it.id === itemId);
          if (item) startEdit(item);
          return;
        }
        // 借用记录
        const borrowBtn = e.target.closest("[data-borrow]");
        if (borrowBtn) {
          const itemId = borrowBtn.dataset.borrow;
          showBorrowDialog(itemId);
          return;
        }
        // 二维码
        const qrBtn = e.target.closest("[data-qr]");
        if (qrBtn) {
          const itemId = qrBtn.dataset.qr;
          const overlay = document.createElement("div");
          overlay.className = "img-overlay";
          overlay.innerHTML = `<div style="background:var(--panel);padding:24px;border-radius:16px;text-align:center;cursor:default">
            <img src="/api/items/${itemId}/qrcode" style="width:200px;height:200px;border-radius:8px" />
            <p style="margin:8px 0 0;color:var(--text);font-size:14px">扫码查看物品</p>
            <p style="margin:4px 0 0;color:var(--muted);font-size:12px">点击任意位置关闭</p>
          </div>`;
          overlay.onclick = () => overlay.remove();
          document.body.appendChild(overlay);
          return;
        }
        // 归档
        const archiveBtn = e.target.closest("[data-archive]");
        if (archiveBtn) {
          api.post(`/items/${archiveBtn.dataset.archive}/archive`).then(() => loadItems());
          return;
        }
        // 取消归档
        const unarchiveBtn = e.target.closest("[data-unarchive]");
        if (unarchiveBtn) {
          api.post(`/items/${unarchiveBtn.dataset.unarchive}/unarchive`).then(() => loadItems());
          return;
        }
        // 删除
        const delBtn = e.target.closest("[data-del]");
        if (delBtn) {
          if (!confirm("确认删除？")) return;
          api.del(`/items/${delBtn.dataset.del}`).then(() => loadItems());
        }
      });

      // 批量操作
      const batchBar = el.querySelector("#batch-bar");
      const batchCount = el.querySelector("#batch-count");

      function updateBatchBar() {
        const checked = el.querySelectorAll(".item-cb:checked");
        const count = checked.length;
        if (count > 0) {
          batchBar.style.display = "flex";
          batchCount.textContent = `已选 ${count} 件`;
        } else {
          batchBar.style.display = "none";
        }
      }

      // 单选
      el.querySelectorAll(".item-cb").forEach((cb) => {
        cb.onchange = updateBatchBar;
      });

      // 全选
      el.querySelector("#select-all").onchange = function () {
        el.querySelectorAll(".item-cb").forEach((cb) => (cb.checked = this.checked));
        updateBatchBar();
      };

      // 批量归档
      el.querySelector("#batch-archive").onclick = () => {
        const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
        if (!ids.length) return;
        api.post("/items/batch", { item_ids: ids, action: "archive" }).then(() => loadItems());
      };

      // 批量删除
      el.querySelector("#batch-delete").onclick = () => {
        const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
        if (!ids.length) return;
        if (!confirm(`确认删除 ${ids.length} 件物品？`)) return;
        api.post("/items/batch", { item_ids: ids, action: "delete" }).then(() => loadItems());
      };

      // 批量改状态
      el.querySelector("#batch-status").onchange = function () {
        if (!this.value) return;
        const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
        if (!ids.length) return;
        api.post("/items/batch", { item_ids: ids, action: "update", status: this.value }).then(() => {
          this.value = "";
          loadItems();
        });
      };

      // 批量改分类
      el.querySelector("#batch-category").onchange = function () {
        if (!this.value) return;
        const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
        if (!ids.length) return;
        api.post("/items/batch", { item_ids: ids, action: "update", category_id: Number(this.value) }).then(() => {
          this.value = "";
          loadItems();
        });
      };
    }
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

async function showBorrowDialog(itemId) {
  const overlay = document.createElement("div");
  overlay.className = "img-overlay";
  overlay.style.cursor = "default";
  try {
    const borrows = await api.get(`/items/${itemId}/borrows`);
    const active = borrows.filter(b => !b.return_date);
    const history = borrows.filter(b => b.return_date);
    overlay.innerHTML = `<div style="background:var(--panel);padding:24px;border-radius:16px;min-width:480px;max-height:80vh;overflow-y:auto;cursor:default" onclick="event.stopPropagation()">
      <h3 style="margin:0 0 12px">借用记录</h3>
      ${active.length ? `<p class="muted">当前未归还：</p>${active.map(b => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1">借给 <b>${escapeHtml(b.borrower_name)}</b>（${b.borrow_date}）</span>
        <span class="tag-chip" style="background:#ff6b6b20;color:#ff6b6b;border-color:#ff6b6b60">未归还</span>
      </div>`).join("")}` : '<p class="muted">当前无未归还记录</p>'}
      <hr style="border-color:var(--border);margin:12px 0" />
      <form id="borrow-form" style="display:flex;gap:8px;flex-wrap:wrap">
        <input name="borrower_name" placeholder="借用人姓名" required style="flex:1;min-width:120px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" />
        <input name="borrow_date" type="date" value="${new Date().toISOString().slice(0,10)}" style="background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" />
        <input name="expected_return_date" type="date" placeholder="预计归还" style="background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" />
        <button type="submit" style="background:var(--accent);color:#fff;border:none;padding:8px 16px;border-radius:8px">借出</button>
      </form>
      ${history.length ? `<hr style="border-color:var(--border);margin:12px 0" /><p class="muted">归还记录：</p>${history.map(b => `<div style="padding:4px 0;font-size:13px;color:var(--muted)">借给 ${escapeHtml(b.borrower_name)}（${b.borrow_date}）→ 已归还 ${b.return_date}</div>`).join("")}` : ""}
      <button onclick="this.closest('.img-overlay').remove()" class="ghost" style="margin-top:12px;width:100%">关闭</button>
    </div>`;
    overlay.querySelector("#borrow-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api.post(`/items/${itemId}/borrows`, {
        borrower_name: fd.get("borrower_name"),
        borrow_date: fd.get("borrow_date"),
        expected_return_date: fd.get("expected_return_date") || null,
      });
      overlay.remove();
      loadItems();
    };
  } catch (e) {
    overlay.innerHTML = `<p style="color:var(--danger);padding:24px">${e.message}</p>`;
  }
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
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
