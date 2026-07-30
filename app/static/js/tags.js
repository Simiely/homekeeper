// 标签管理：列表 + 新增 + 编辑 + 删除
import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

let editTagId = null;

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
              <td style="white-space:nowrap">
                <button data-edit="${t.id}" style="background:transparent;border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px">编</button>
                <button data-del="${t.id}" style="background:transparent;border:1px solid var(--border);color:var(--danger);padding:4px 8px;border-radius:6px;font-size:12px">删</button>
              </td>
            </tr>
          `).join("") : '<tr><td colspan="3" class="muted">暂无标签</td></tr>'}
        </tbody>
      </table>
    `;

    const form = el.querySelector("#tag-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { name: fd.get("name"), color: fd.get("color") || "#FB7299" };
      if (editTagId) {
        await api.put(`/tags/${editTagId}`, payload);
        cancelEdit(form);
      } else {
        await api.post("/tags", payload);
      }
      renderTags();
    };

    el.querySelector("tbody")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-edit]");
      if (!btn) return;
      const tag = tags.find((t) => t.id === Number(btn.dataset.edit));
      if (!tag) return;
      editTagId = tag.id;
      form.querySelector("[name=name]").value = tag.name;
      form.querySelector("[name=color]").value = tag.color;
      form.querySelector("button[type=submit]").textContent = "保存";
      if (!form.querySelector("#tag-cancel")) {
        const cancel = document.createElement("button");
        cancel.id = "tag-cancel";
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.className = "ghost";
        cancel.onclick = () => { cancelEdit(form); renderTags(); };
        form.querySelector("button[type=submit]").after(cancel);
      }
    });

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

function cancelEdit(form) {
  editTagId = null;
  form.reset();
  form.querySelector("button[type=submit]").textContent = "添加";
  const c = form.querySelector("#tag-cancel");
  if (c) c.remove();
}
