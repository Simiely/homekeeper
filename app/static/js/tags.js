// 标签管理：列表 + 新增 + 编辑 + 删除
import { api } from "./api.js";

export async function renderTags() {
  const el = document.getElementById("view-tags");
  el.innerHTML = "<h2>标签</h2><div class='loading'>加载中…</div>";
  try {
    const tags = await api.get("/tags");

    el.innerHTML = `
      <h2>标签</h2>
      <form id="tag-form" class="card">
        <input name="name" placeholder="标签名称" required />
        <input name="color" type="color" value="#FB7299" title="标签颜色" style="width:48px;padding:4px;flex:0" />
        <button type="submit">添加</button>
      </form>
      <table class="list">
        <thead><tr><th>名称</th><th>颜色</th><th></th></tr></thead>
        <tbody>
          ${tags.length ? tags.map(t => `
            <tr>
              <td><span class="tag-chip" style="background:${t.color}20;color:${t.color};border-color:${t.color}">${escapeHtml(t.name)}</span></td>
              <td><span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:${t.color};vertical-align:middle"></span> ${t.color}</td>
              <td><button data-del="${t.id}" style="background:transparent;border:1px solid var(--border);color:var(--danger);padding:4px 10px;border-radius:6px;font-size:12px">删</button></td>
            </tr>
          `).join("") : '<tr><td colspan="3" class="muted">暂无标签</td></tr>'}
        </tbody>
      </table>
    `;

    el.querySelector("#tag-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api.post("/tags", { name: fd.get("name"), color: fd.get("color") || "#FB7299" });
      renderTags();
    };

    el.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确认删除？标签将从所有物品中移除。")) return;
        await api.del(`/tags/${b.dataset.del}`);
        renderTags();
      };
    });
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
