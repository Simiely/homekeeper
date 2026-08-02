// 物品列表：loadItems / 分页 / 紧凑行渲染（突出位置·数量·保质期）/ 选中联动详情 / 筛选栏 / CSV
// 通过 initList(ctx) 注入上下文（items.js 编排器创建 ctx），无循环依赖
// 行内不再放操作按钮（编辑/日志/借用/二维码/已处理/删除 都在详情卡片 items-detail.js）
import { api, imgUrl } from "./api.js";
import { buildLocPath, escapeHtml, showDialog, showOverlay, todayStr, viewError } from "./utils.js";

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
    // 勾选框（批量）：不触发行选中
    if (e.target.closest(".item-cb")) return;
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
    // 选中一行 → 详情卡片更新（高亮当前行）
    const row = e.target.closest("[data-sel]");
    if (row) {
      const itemId = Number(row.dataset.sel);
      selectItem(itemId);
      return;
    }
  });

  // 选中物品：同步 ctx / URL，刷新详情卡片与行高亮
  function selectItem(id) {
    ctx.selectedId = id;
    window.syncHash?.({ sel: id }, { replace: true });
    ctx.renderDetail(id);
    listEl.querySelectorAll("[data-sel]").forEach((r) => r.classList.toggle("active", Number(r.dataset.sel) === id));
  }

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
    // 筛选条件 + 选中物品同步到 URL（输入类，replace 不产生碎历史；可刷新保留/分享；不含分页）
    window.syncHash?.(
      {
        kw: kw || undefined,
        status_filter: st || undefined,
        category_id: ca || undefined,
        location_id: lo || undefined,
        tag_id: ta || undefined,
        show_archived: el.querySelector("#f-archived").checked ? "1" : undefined,
        sel: ctx.selectedId || undefined,
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

    // 保质期角标：已过期 X 天 / 今天到期 / 剩 X 天
    const expiryText = (d) => {
      const days = Math.round((new Date(d) - new Date(todayStr())) / 86400000);
      return days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`;
    };

    const rows = ctx.items
      .map((it) => {
        const img = imgMap[it.id];
        const thumb = img
          ? `<div class="item-thumb" data-img="${imgUrl(`/api/images/${img.item_id}/${img.filename}`)}" title="点击放大">
               <img src="${imgUrl(`/api/images/${img.item_id}/${img.filename}`)}" alt="" loading="lazy" />
             </div>`
          : `<div class="item-thumb empty">📦</div>`;
        const loc = locPath(it.location_id);
        const expBadge = it.expiry_date
          ? `<span class="badge ${it.expiry_date < todayStr() ? "badge-exp" : "badge-warn"}">${expiryText(it.expiry_date)}</span>`
          : "";
        return `
      <div class="item-row${it.archived ? " archived" : ""}${it.id === ctx.selectedId ? " active" : ""}" data-sel="${it.id}">
        <input type="checkbox" class="item-cb" value="${it.id}" title="批量选择" />
        ${thumb}
        <div class="item-row-main">
          <div class="item-row-top">
            <span class="item-row-name">${escapeHtml(it.name)}</span>
            <span class="item-row-status">${escapeHtml(it.status)}</span>
          </div>
          <div class="item-row-loc">📍 ${loc ? escapeHtml(loc) : "未设置位置"}${it.location_note ? "（" + escapeHtml(it.location_note) + "）" : ""}</div>
          <div class="item-row-meta">
            <span>数量：${it.quantity} ${escapeHtml(it.unit)}</span>
            ${expBadge}
          </div>
        </div>
      </div>`;
      })
      .join("");

    listEl.innerHTML = `
      <p class="muted" style="display:flex;align-items:center;gap:10px">
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer" title="全选当前页">
          <input type="checkbox" id="select-all" /> 全选
        </label>
        <span>共 ${total} 件 · 第 ${data.page}/${totalPages} 页</span>
      </p>
      ${rows || '<p class="muted">无匹配物品</p>'}
      <div id="batch-bar" class="batch-bar" style="display:none">
        <span id="batch-count" class="muted" style="margin-right:8px">已选 0 件</span>
        <select id="batch-status"><option value="">改状态</option>${(ctx.statusOptions || []).map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
        <select id="batch-category"><option value="">改分类</option>${ctx.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
        <button id="batch-archive" class="ghost" style="font-size:12px">已处理</button>
        <button id="batch-delete" class="ghost" style="font-size:12px;color:var(--danger)">删除</button>
      </div>
      ${renderPagination(data)}
    `;

    // 批量操作条绑定（由 items-batch.js 提供，重渲染后重新绑定）
    ctx.bindBatch?.();
    // 详情卡片随列表刷新（保留选中；被删除/移出当前列表的物品自动回落占位）
    ctx.renderDetail?.(ctx.selectedId);
  }

  ctx.loadItems = loadItems;
  loadItems(); // 初次加载
}
