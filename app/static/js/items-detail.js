// 物品详情卡片：主-从布局中，选中列表某行 → 卡片更新为选中物品的完整信息与操作
// 由 initDetail(ctx) 注入 ctx.renderDetail(itemId)；列表重渲染/选中/操作后调用
import { api, imgUrl } from "./api.js";
import { showBorrowDialog, showLogDialog } from "./item-dialogs.js";
import { buildLocPath, escapeHtml, showDialog, showOverlay, todayStr } from "./utils.js";

export function initDetail(ctx) {
  const el = ctx.el;
  const detailEl = el.querySelector("#item-detail");
  const pathOf = buildLocPath(ctx.locations);

  // 从 URL 恢复选中（刷新 #/items?sel=12 或后退回来）
  const urlSel = Number(window.__viewParams?.get("sel"));
  if (urlSel) ctx.selectedId = urlSel;

  // 保质期文案：已过期 X 天 / 今天到期 / 剩 X 天
  function expiryText(d) {
    const days = Math.round((new Date(d) - new Date(todayStr())) / 86400000);
    return days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`;
  }

  function field(k, v, extraCls = "") {
    return `<div class="detail-field ${extraCls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  }

  async function renderDetail(id) {
    ctx.selectedId = id || null;
    if (!id) {
      detailEl.innerHTML = `<div class="item-detail"><div class="item-detail-empty">点击左侧列表中的物品，查看详细信息</div></div>`;
      return;
    }
    detailEl.innerHTML = '<div class="item-detail"><p class="muted">加载中…</p></div>';
    let item;
    let imgs = [];
    try {
      [item, imgs] = await Promise.all([
        api.get(`/items/${id}`),
        api.get(`/items/${id}/images`).catch(() => []),
      ]);
    } catch (e) {
      detailEl.innerHTML = `<div class="item-detail"><p class="err">${e.message}</p></div>`;
      return;
    }

    const img = imgs[0];
    const photoHtml = img
      ? `<div class="detail-photo" data-img="${imgUrl(`/api/images/${img.item_id}/${img.filename}`)}" title="点击放大">
           <img src="${imgUrl(`/api/images/${img.item_id}/${img.filename}`)}" alt="" loading="lazy" />
         </div>`
      : `<div class="detail-photo" title="暂无照片">📦</div>`;

    const locPath = pathOf(item.location_id);
    const expBadge = item.expiry_date
      ? `<span class="badge ${item.expiry_date < todayStr() ? "badge-exp" : "badge-warn"}">${expiryText(item.expiry_date)}</span>`
      : "";

    const rows = [];
    rows.push(field("位置", locPath ? `<span class="loc-link" data-lid="${item.location_id}">📍 ${escapeHtml(locPath)}</span>` : "—"));
    if (item.location_note) rows.push(field("备注", escapeHtml(item.location_note)));
    rows.push(field("数量", `${item.quantity} ${escapeHtml(item.unit || "")}`));
    const catName = ctx.categories.find((c) => c.id === item.category_id)?.name;
    if (catName) rows.push(field("分类", escapeHtml(catName)));
    if (item.price != null) rows.push(field("价格", "¥" + Number(item.price).toFixed(2)));
    if (item.expiry_date) rows.push(field("保质期", `${escapeHtml(item.expiry_date)} ${expBadge}`));
    if (item.purchase_date) rows.push(field("购买日期", escapeHtml(item.purchase_date)));
    if (item.shelf_life_days) rows.push(field("保质天数", `${item.shelf_life_days} 天`));
    if (item.serial_number) rows.push(field("序列号", escapeHtml(item.serial_number)));
    if (item.barcode) rows.push(field("条码", escapeHtml(item.barcode)));
    if (item.warranty_expiry) rows.push(field("保修到期", escapeHtml(item.warranty_expiry)));
    if ((item.tags || []).length) {
      rows.push(
        field(
          "标签",
          item.tags
            .map((t) => `<span class="tag-chip" style="background:${t.color}20;color:${t.color};border-color:${t.color}60">${escapeHtml(t.name)}</span>`)
            .join(" ")
        )
      );
    }
    if (item.description) rows.push(field("描述", escapeHtml(item.description), "full"));

    detailEl.innerHTML = `
      <div class="item-detail${item.archived ? " archived" : ""}">
        <div class="detail-head">
          ${photoHtml}
          <div style="flex:1;min-width:0">
            <div class="detail-name">${escapeHtml(item.name)}</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="detail-status">${escapeHtml(item.status)}</span>
              ${item.archived ? '<span class="detail-status dim">已处理</span>' : ""}
            </div>
          </div>
        </div>
        <div class="detail-grid">${rows.join("")}</div>
        <div class="detail-actions">
          <button class="mini-btn" data-act="edit">编辑</button>
          <button class="mini-btn muted" data-act="log">日志</button>
          <button class="mini-btn muted" data-act="borrow">借用</button>
          <button class="mini-btn muted" data-act="qr">二维码</button>
          <button class="mini-btn muted" data-act="photo">照片</button>
          ${item.archived
            ? `<button class="mini-btn muted" data-act="unarchive">撤销已处理</button>`
            : `<button class="mini-btn muted" data-act="archive">已处理</button>`}
          <button class="mini-btn danger" data-act="del" style="margin-left:auto">删除</button>
        </div>
      </div>
    `;

    // ---- 详情卡片操作绑定（每次重渲染后绑定）----
    const card = detailEl.querySelector(".item-detail");

    // 照片点击放大
    card.querySelector(".detail-photo[data-img]")?.addEventListener("click", (e) => {
      showOverlay({ content: `<img src="${e.currentTarget.dataset.img}" alt="" />` });
    });
    // 位置路径 → 位置页展开
    card.querySelector(".loc-link")?.addEventListener("click", (e) => {
      const lid = Number(e.currentTarget.dataset.lid);
      if (lid) window.showView("locations", { open: lid });
    });
    // 编辑 → 添加页（编辑模式），保存后回到本页并选中
    card.querySelector('[data-act="edit"]').onclick = () => window.showView("add", { id: item.id });
    card.querySelector('[data-act="log"]').onclick = () => showLogDialog(item.id);
    card.querySelector('[data-act="borrow"]').onclick = () => showBorrowDialog(item.id, () => ctx.loadItems());
    card.querySelector('[data-act="qr"]').onclick = () => {
      showOverlay({
        content: `<div style="background:var(--panel);padding:24px;border-radius:16px;text-align:center;cursor:default">
          <img src="${imgUrl(`/api/items/${item.id}/qrcode`)}" style="width:200px;height:200px;border-radius:8px" />
          <p style="margin:8px 0 0;color:var(--text);font-size:14px">扫码查看物品</p>
          <p style="margin:4px 0 0;color:var(--muted);font-size:12px">点击空白处关闭</p>
        </div>`,
      });
    };
    // 照片上传（详情卡片补图）
    card.querySelector('[data-act="photo"]').onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const form = new FormData();
          form.append("file", file);
          await api.upload(`/items/${item.id}/images`, form);
          ctx.loadItems();
          renderDetail(item.id); // 立即刷新卡片
        } catch (err) {
          showDialog({ title: "上传失败", message: err.message, confirmText: "知道了" });
        }
      });
      input.click();
    };
    // 已处理 / 撤销已处理 → 刷新列表与卡片
    const archiveBtn = card.querySelector('[data-act="archive"]');
    if (archiveBtn) archiveBtn.onclick = () => api.post(`/items/${item.id}/archive`).then(() => ctx.loadItems());
    const unarchiveBtn = card.querySelector('[data-act="unarchive"]');
    if (unarchiveBtn) unarchiveBtn.onclick = () => api.post(`/items/${item.id}/unarchive`).then(() => ctx.loadItems());
    // 删除 → 确认后删除，清空选中
    card.querySelector('[data-act="del"]').onclick = async () => {
      const ok = await showDialog({
        title: "删除物品",
        message: `确认删除「${item.name}」？此操作不可恢复。`,
        confirmText: "删除",
        cancelText: "取消",
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/items/${item.id}`);
        ctx.selectedId = null;
        ctx.loadItems();
        renderDetail(null);
      } catch (e) {
        showDialog({ title: "删除失败", message: e.message, confirmText: "知道了" });
      }
    };
  }

  ctx.renderDetail = renderDetail;
}
