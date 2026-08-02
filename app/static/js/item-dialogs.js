// 物品详情弹窗：操作日志 / 借用记录
// 复用 utils.showOverlay 统一弹窗体系；借用记录变更后通过 onChanged 回调刷新列表。
import { api } from "./api.js";
import { escapeHtml, showDialog, showOverlay } from "./utils.js";

const ACTION_COLOR = { create: "#4CAF50", delete: "#ff6b6b", update: "#FB7299" };
const ACTION_LABEL = { create: "创建", delete: "删除", update: "修改" };

export async function showLogDialog(itemId) {
  let logs;
  try {
    logs = await api.get(`/items/${itemId}/logs`);
  } catch (e) {
    showDialog({ title: "加载失败", message: e.message, confirmText: "知道了" });
    return;
  }
  const { overlay, close } = showOverlay({
    content: `<div class="hk-dialog-body hk-scroll">
      <h3 class="hk-dialog-title">操作日志</h3>
      ${logs.length
        ? logs
            .map(
              (l) => `<div class="hk-log-row">
        <span class="tag-chip" style="background:${ACTION_COLOR[l.action] || "#FB7299"}20;color:${ACTION_COLOR[l.action] || "#FB7299"};border-color:transparent;font-size:11px">${ACTION_LABEL[l.action] || l.action}</span>
        <span class="hk-log-time">${l.created_at.slice(0, 19).replace("T", " ")}</span>
        <div class="hk-log-summary">${escapeHtml(l.summary)}</div>
      </div>`
            )
            .join("")
        : '<p class="muted">暂无操作记录</p>'}
      <button type="button" class="ghost hk-dialog-close" style="margin-top:12px;width:100%">关闭</button>
    </div>`,
  });
  overlay.querySelector(".hk-dialog-close").onclick = close;
}

export async function showBorrowDialog(itemId, onChanged) {
  let borrows;
  try {
    borrows = await api.get(`/items/${itemId}/borrows`);
  } catch (e) {
    showDialog({ title: "加载失败", message: e.message, confirmText: "知道了" });
    return;
  }
  const active = borrows.filter((b) => !b.return_date);
  const history = borrows.filter((b) => b.return_date);
  const { overlay, close } = showOverlay({
    content: `<div class="hk-dialog-body hk-scroll">
      <h3 class="hk-dialog-title">借用记录</h3>
      ${active.length
        ? `<p class="muted">当前未归还：</p>` +
          active
            .map(
              (b) => `<div class="hk-borrow-active">
        <span style="flex:1">借给 <b>${escapeHtml(b.borrower_name)}</b>（${b.borrow_date}）</span>
        <span class="tag-chip" style="background:#ff6b6b20;color:#ff6b6b;border-color:#ff6b6b60">未归还</span>
      </div>`
            )
            .join("")
        : '<p class="muted">当前无未归还记录</p>'}
      <hr class="hk-divider" />
      <form id="borrow-form" class="hk-borrow-form">
        <input name="borrower_name" placeholder="借用人姓名" required />
        <input name="borrow_date" type="date" value="${new Date().toISOString().slice(0, 10)}" />
        <input name="expected_return_date" type="date" placeholder="预计归还" />
        <button type="submit">借出</button>
      </form>
      ${history.length
        ? `<hr class="hk-divider" /><p class="muted">归还记录：</p>` +
          history
            .map(
              (b) => `<div class="hk-log-row hk-log-time">借给 ${escapeHtml(b.borrower_name)}（${b.borrow_date}）→ 已归还 ${b.return_date}</div>`
            )
            .join("")
        : ""}
      <button type="button" class="ghost hk-dialog-close" style="margin-top:12px;width:100%">关闭</button>
    </div>`,
  });
  overlay.querySelector(".hk-dialog-close").onclick = close;
  overlay.querySelector("#borrow-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/items/${itemId}/borrows`, {
        borrower_name: fd.get("borrower_name"),
        borrow_date: fd.get("borrow_date"),
        expected_return_date: fd.get("expected_return_date") || null,
      });
      close();
      onChanged?.();
    } catch (err) {
      showDialog({ title: "借出失败", message: err.message, confirmText: "知道了" });
    }
  };
}
