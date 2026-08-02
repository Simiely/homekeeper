// 物品列表：loadItems / 分页 / 行渲染 / 列表事件委托 / 筛选栏 / CSV 导入导出
// 通过 initList(ctx) 注入上下文（items.js 编排器创建 ctx），无循环依赖
import { api, imgUrl } from "./api.js";
import { showBorrowDialog, showLogDialog } from "./item-dialogs.js";
import { buildLocPath, escapeHtml, showDialog, showOverlay, viewError } from "./utils.js";

export function initList(ctx) {
  const el = ctx.el;

  // 从 URL 恢复筛选条件（刷新 #/items?kw=xx 或浏览器后退回来）
  const urlP = window.__viewParams;
  if (urlP) {
    const setVal = (id, v) => {
      if (v != null && v !== "") el.querySelector(id).value = v;
    };
    setVal("#f-keyword", urlP.get("kw"));
    setVal("#f-status", urlP.get("status_filter"));
    setVal("#f-category", urlP.get("category_id"));
    setVal("#f-location", urlP.get("location_id"));
    setVal("#f-tag", urlP.get("tag_id"));
    if (urlP.get("show_archived")) el.querySelector("#f-archived").checked = true;
  }

  // ===== 事件委托（只注册一次，#item-list 是常驻节点，重渲染只改 innerHTML）=====
  const listEl = el.querySelector("#item-list");
  listEl.addEventListener("click", async (e) => {
    // 上传图片
    const uploadBtn = e.target.closest("[data-upload-item]");
    if (uploadBtn) {
      const itemId = uploadBtn.dataset.uploadItem;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        uploadBtn.classList.add("uploading");
        uploadBtn.textContent = "…";
        try {
          const form = new FormData();
          form.append("file", file);
          await api.upload(`/items/${itemId}/images`, form);
          ctx.loadItems();
        } catch (err) {
          showDialog({ title: "上传失败", message: err.message, confirmText: "知道了" });
          uploadBtn.classList.remove("uploading");
          uploadBtn.textContent = "+";
        }
      });
      input.click();
      return;
    }
    // 图片点击放大
    const imgWrap = e.target.closest("[data-img]");
    if (imgWrap) {
      showOverlay({ content: `<img src="${imgWrap.dataset.img}" alt="" />` });
      return;
    }
    // 翻页
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) {
      if (pageBtn.disabled) return;
      ctx.currentPage = Number(pageBtn.dataset.page);
      ctx.loadItems();
      return;
    }
    // 编辑（分派给表单模块）
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      const itemId = Number(editBtn.dataset.edit);
      const item = ctx.items.find((it) => it.id === itemId);
      if (item && ctx.startEdit) ctx.startEdit(item);
      return;
    }
    // 日志
    const logBtn = e.target.closest("[data-log]");
    if (logBtn) {
      showLogDialog(logBtn.dataset.log);
      return;
    }
    // 借用记录
    const borrowBtn = e.target.closest("[data-borrow]");
    if (borrowBtn) {
      showBorrowDialog(borrowBtn.dataset.borrow, ctx.loadItems);
      return;
    }
    // 二维码
    const qrBtn = e.target.closest("[data-qr]");
    if (qrBtn) {
      const itemId = qrBtn.dataset.qr;
      showOverlay({
        content: `<div style="background:var(--panel);padding:24px;border-radius:16px;text-align:center;cursor:default">
          <img src="${imgUrl(`/api/items/${itemId}/qrcode`)}" style="width:200px;height:200px;border-radius:8px" />
          <p style="margin:8px 0 0;color:var(--text);font-size:14px">扫码查看物品</p>
          <p style="margin:4px 0 0;color:var(--muted);font-size:12px">点击空白处关闭</p>
        </div>`,
      });
      return;
    }
    // 归档 / 取消归档
    const archiveBtn = e.target.closest("[data-archive]");
    if (archiveBtn) {
      api.post(`/items/${archiveBtn.dataset.archive}/archive`).then(() => ctx.loadItems());
      return;
    }
    const unarchiveBtn = e.target.closest("[data-unarchive]");
    if (unarchiveBtn) {
      api.post(`/items/${unarchiveBtn.dataset.unarchive}/unarchive`).then(() => ctx.loadItems());
      return;
    }
    // 删除
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const ok = await showDialog({
        title: "删除物品",
        message: "确认删除？此操作不可恢复。",
        confirmText: "删除",
        cancelText: "取消",
        danger: true,
      });
      if (!ok) return;
      api.del(`/items/${delBtn.dataset.del}`).then(() => ctx.loadItems());
    }
  });

  // ===== 筛选栏 =====
  const doSearch = () => {
    ctx.currentPage = 1;
    ctx.loadItems();
  };
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
    ctx.loadItems();
  };

  // ===== CSV 导入导出 =====
  el.querySelector("#export-csv").onclick = async () => {
    try {
      await api.download("/export/items");
    } catch (e) {
      showDialog({ title: "导出失败", message: e.message, confirmText: "知道了" });
    }
  };
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
      showDialog({ title: "导入完成", message: msg, confirmText: "知道了" });
      ctx.loadItems();
    } catch (e) {
      showDialog({ title: "导入失败", message: e.message, confirmText: "知道了" });
    }
    fileInput.value = "";
  };

  // ===== 分页条 =====
  function renderPagination(d) {
    if (d.total_pages <= 1) return "";
    let html = '<div class="pagination">';
    const prevDisabled = d.page <= 1 ? "disabled" : "";
    html += `<button class="page-btn" data-page="${d.page - 1}" ${prevDisabled}>‹ 上一页</button>`;
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
    return html;
  }

  // ===== 列表加载 =====
  async function loadItems() {
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
    params.set("page", ctx.currentPage);
    params.set("page_size", "20");
    // 筛选条件同步到 URL（输入类，replace 不产生碎历史；可刷新保留/分享；不含分页）
    window.syncHash?.(
      {
        kw: kw || undefined,
        status_filter: st || undefined,
        category_id: ca || undefined,
        location_id: lo || undefined,
        tag_id: ta || undefined,
        show_archived: el.querySelector("#f-archived").checked ? "1" : undefined,
      },
      { replace: true }
    );
    const qs = params.toString();

    let data;
    try {
      data = await api.get("/items?" + qs);
    } catch (e) {
      listEl.innerHTML = viewError(e.message);
      return;
    }
    ctx.items = data.items;
    const total = data.total;
    const totalPages = data.total_pages;

    const locPath = buildLocPath(ctx.locations);
    const catMap = Object.fromEntries(ctx.categories.map((c) => [c.id, c.name]));

    // 并发获取所有物品的图片（取第一张）
    const imgMap = {};
    await Promise.all(
      ctx.items.map(async (it) => {
        try {
          const imgs = await api.get(`/items/${it.id}/images`);
          if (imgs.length > 0) imgMap[it.id] = imgs[0];
        } catch {
          // 静默失败，不阻塞列表渲染
        }
      })
    );

    const rows = ctx.items
      .map((it) => {
        const img = imgMap[it.id];
        const imgCell = img
          ? `<div class="thumb-wrap" data-img="${imgUrl(`/api/images/${img.item_id}/${img.filename}`)}" title="点击放大">
               <img src="${imgUrl(`/api/images/${img.item_id}/${img.filename}`)}" alt="" loading="lazy" />
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
        <button data-edit="${it.id}" class="mini-btn">编</button>
        <button data-log="${it.id}" class="mini-btn muted" title="操作日志">日志</button>
        <button data-borrow="${it.id}" class="mini-btn muted" title="借用记录">借</button>
        <button data-qr="${it.id}" class="mini-btn muted" title="二维码">◈</button>
        ${it.archived
          ? `<button data-unarchive="${it.id}" class="mini-btn muted">取消归档</button>`
          : `<button data-archive="${it.id}" class="mini-btn muted">归档</button>`}
        <button data-del="${it.id}" class="mini-btn danger">删</button>
      </td>
    </tr>`;
      })
      .join("");

    listEl.innerHTML = `
      <p class="muted">共 ${total} 件 · 第 ${data.page}/${totalPages} 页</p>
      <table class="list">
        <thead><tr><th style="width:32px"><input type="checkbox" id="select-all" /></th><th>名称</th><th>位置</th><th>分类</th><th>数量</th><th>价格</th><th>状态</th><th>保质期</th><th>序列号</th><th>保修</th><th>标签</th><th>图片</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="13" class="muted">无匹配物品</td></tr>'}</tbody>
      </table>
      <div id="batch-bar" class="batch-bar" style="display:none">
        <span id="batch-count" class="muted" style="margin-right:8px">已选 0 件</span>
        <select id="batch-status"><option value="">改状态</option>${(ctx.statusOptions || []).map(s => `<option value="${s}">${s}</option>`).join("")}</select>
        <select id="batch-category"><option value="">改分类</option>${ctx.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
        <button id="batch-archive" class="ghost" style="font-size:12px">归档</button>
        <button id="batch-delete" class="ghost" style="font-size:12px;color:var(--danger)">删除</button>
      </div>
      ${renderPagination(data)}
    `;

    // 批量操作条绑定（由 items-batch.js 提供，重渲染后重新绑定）
    ctx.bindBatch?.();
  }

  ctx.loadItems = loadItems;
  loadItems(); // 初次加载
}
