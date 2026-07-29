// 分类视图：列表 + 新增（带颜色） + 删除
import { api } from "./api.js";

export async function renderCategories() {
  const el = document.getElementById("view-categories");
  el.innerHTML = "<h2>分类</h2><div class='loading'>加载中…</div>";
  try {
    const cats = await api.get("/categories");
    const rows = cats
      .map(
        (c) => `
      <tr>
        <td><span class="dot" style="background:${escapeHtml(
          c.color
        )}"></span> ${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.color)}</td>
        <td><button data-del="${c.id}">删</button></td>
      </tr>`
      )
      .join("");

    el.innerHTML = `
      <h2>分类 / 标签</h2>
      <form id="cat-form" class="card">
        <input name="name" placeholder="分类名称" required />
        <input name="color" type="color" value="#fb7299" title="颜色" />
        <button type="submit">添加</button>
      </form>
      <table class="list">
        <thead><tr><th>名称</th><th>颜色</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    el.querySelector("#cat-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api.post("/categories", {
        name: fd.get("name"),
        color: fd.get("color"),
      });
      renderCategories();
    };

    el.querySelectorAll("button[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确认删除？")) return;
        await api.del(`/categories/${b.dataset.del}`);
        renderCategories();
      };
    });
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
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
