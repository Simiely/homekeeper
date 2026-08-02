// 备份管理：列表 + 手动备份 + 恢复
import { api } from "./api.js";
import { escapeHtml, viewError, viewLoading } from "./utils.js";

export async function renderBackups() {
  const el = document.getElementById("view-backups");
  el.innerHTML = viewLoading("备份");
  try {
    const data = await api.get("/backups");
    const backups = data.backups;

    const lastBackup = backups.length > 0 ? backups[0].created_at.slice(0, 19).replace("T", " ") : "暂无";

    el.innerHTML = `
      <h2>备份管理</h2>
      <div class="card" style="display:flex;align-items:center;gap:16px">
        <span class="muted">自动备份：每小时</span>
        <span class="muted">保留：48 份</span>
        <span class="muted">上次备份：${lastBackup}</span>
        <span class="muted">备份数：${backups.length}</span>
        <button id="backup-now" class="ghost">立即备份</button>
      </div>
      <table class="list">
        <thead><tr><th>备份文件</th><th>大小</th><th>创建时间</th><th></th></tr></thead>
        <tbody>
          ${backups.length ? backups.map(b => {
            const size = b.size > 1024 * 1024
              ? (b.size / 1024 / 1024).toFixed(1) + " MB"
              : (b.size / 1024).toFixed(1) + " KB";
            return `<tr>
              <td>${escapeHtml(b.filename)}</td>
              <td>${size}</td>
              <td>${b.created_at.slice(0, 19).replace("T", " ")}</td>
              <td><button data-restore="${b.filename}" class="mini-btn danger">恢复</button></td>
            </tr>`;
          }).join("") : '<tr><td colspan="4" class="muted">暂无备份</td></tr>'}
        </tbody>
      </table>
    `;

    // 手动备份
    el.querySelector("#backup-now").onclick = async () => {
      const btn = el.querySelector("#backup-now");
      btn.textContent = "备份中…";
      btn.disabled = true;
      try {
        const r = await api.post("/backups/trigger");
        if (r.ok) alert("备份完成：" + r.filename);
        else alert("备份跳过：" + r.reason);
      } catch (e) {
        alert("备份失败：" + e.message);
      }
      renderBackups();
    };

    // 恢复（委托）
    el.querySelector("tbody")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-restore]");
      if (!btn) return;
      const filename = btn.dataset.restore;
      if (!confirm(`确认从 ${filename} 恢复？\n\n当前数据将被覆盖，此操作不可撤销！`)) return;
      if (!confirm("再次确认：所有未备份的数据将丢失，确定恢复？")) return;
      api.post(`/backups/${filename}/restore`).then(() => {
        alert("恢复成功！页面即将刷新。");
        location.reload();
      }).catch((err) => alert("恢复失败：" + err.message));
    });
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}
