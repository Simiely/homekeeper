// 分类视图：列表 + 新增 + 编辑 + 删除（带颜色）
import { api } from "./api.js";
import { escapeHtml, viewError, viewLoading } from "./utils.js";

let editId = null;

export async function renderCategories() {
  const el = document.getElementById("view-categories");
  el.innerHTML = viewLoading("分类");
  try {
    const cats = await api.get("/categories");
    const rows = cats
      .map(
        (c) => `
      <tr>
        <td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${escapeHtml(c.color)};vertical-align:middle"></span> ${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.color)}</td>
        <td style="white-space:nowrap">
          <button data-edit="${c.id}" class="mini-btn">编</button>
          <button data-del="${c.id}" class="mini-btn danger">删</button>
        </td>
      </tr>`
      )
      .join("");

    el.innerHTML = `
      <h2>分类</h2>
      <form id="cat-form" class="card">
        <input name="name" placeholder="分类名称" required />
        <input name="color" type="color" value="#fb7299" title="颜色" style="width:48px;padding:4px;flex:0" />
        <button type="submit">添加</button>
      </form>
      <table class="list">
        <thead><tr><th>名称</th><th>颜色</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    const form = el.querySelector("#cat-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { name: fd.get("name"), color: fd.get("color") };
      if (editId) {
        await api.put(`/categories/${editId}`, payload);
        cancelEdit(form);
      } else {
        await api.post("/categories", payload);
      }
      renderCategories();
    };

    el.querySelector("[data-edit]")?.closest("tbody")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-edit]");
      if (!btn) return;
      const cat = cats.find((c) => c.id === Number(btn.dataset.edit));
      if (!cat) return;
      editId = cat.id;
      form.querySelector("[name=name]").value = cat.name;
      form.querySelector("[name=color]").value = cat.color;
      form.querySelector("button[type=submit]").textContent = "保存";
      if (!form.querySelector("#cat-cancel")) {
        const cancel = document.createElement("button");
        cancel.id = "cat-cancel";
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.className = "ghost";
        cancel.onclick = () => { cancelEdit(form); renderCategories(); };
        form.querySelector("button[type=submit]").after(cancel);
      }
    });

    el.querySelectorAll("button[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确认删除？")) return;
        await api.del(`/categories/${b.dataset.del}`);
        renderCategories();
      };
    });
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}

function cancelEdit(form) {
  editId = null;
  form.reset();
  form.querySelector("button[type=submit]").textContent = "添加";
  const c = form.querySelector("#cat-cancel");
  if (c) c.remove();
}
