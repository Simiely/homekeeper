// 物品详情弹窗：操作日志 / 借用记录
// 独立模块，降低 items.js 体积；借用记录变更后通过 onChanged 回调刷新列表。
import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

export async function showLogDialog(itemId) {
  const overlay = document.createElement("div");
  overlay.className = "img-overlay";
  overlay.style.cursor = "default";
  try {
    const logs = await api.get(`/items/${itemId}/logs`);
    overlay.innerHTML = `<div style="background:var(--panel);padding:24px;border-radius:16px;min-width:480px;max-height:70vh;overflow-y:auto;cursor:default" onclick="event.stopPropagation()">
      <h3 style="margin:0 0 12px">操作日志</h3>
      ${logs.length ? logs.map(l => `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span class="tag-chip" style="background:${l.action === 'create' ? '#4CAF50' : l.action === 'delete' ? '#ff6b6b' : '#FB7299'}20;color:${l.action === 'create' ? '#4CAF50' : l.action === 'delete' ? '#ff6b6b' : '#FB7299'};border-color:transparent;font-size:11px">${l.action === 'create' ? '创建' : l.action === 'delete' ? '删除' : '修改'}</span>
        <span style="color:var(--muted);margin-left:8px">${l.created_at.slice(0,19).replace('T',' ')}</span>
        <div style="margin-top:4px;color:var(--text)">${escapeHtml(l.summary)}</div>
      </div>`).join("") : '<p class="muted">暂无操作记录</p>'}
      <button onclick="this.closest('.img-overlay').remove()" class="ghost" style="margin-top:12px;width:100%">关闭</button>
    </div>`;
  } catch (e) {
    overlay.innerHTML = `<p style="color:var(--danger);padding:24px">${e.message}</p>`;
  }
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

export async function showBorrowDialog(itemId, onChanged) {
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
      onChanged?.();
    };
  } catch (e) {
    overlay.innerHTML = `<p style="color:var(--danger);padding:24px">${e.message}</p>`;
  }
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
