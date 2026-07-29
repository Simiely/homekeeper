// 位置视图：层级列表 + 新增 + 删除（删除时子级提升一级）
import { api } from "./api.js";

export async function renderLocations() {
  const el = document.getElementById("view-locations");
  el.innerHTML = "<h2>位置</h2><div class='loading'>加载中…</div>";
  try {
    const locs = await api.get("/locations");
    const rows = locs
      .map(
        (l) => `
      <tr>
        <td>${l.id}</td>
        <td>${escapeHtml(l.name)}</td>
        <td>${l.parent_id ?? "—"}</td>
        <td>${escapeHtml(l.note) || "—"}</td>
        <td><button data-del="${l.id}">删</button></td>
      </tr>`
      )
      .join("");

    el.innerHTML = `
      <h2>位置（层级树）</h2>
      <form id="loc-form" class="card">
        <input name="name" placeholder="位置名称" required />
        <input name="parent_id" type="number" placeholder="父级ID（可空）" />
        <input name="note" placeholder="备注" />
        <button type="submit">添加</button>
      </form>
      <table class="list">
        <thead><tr><th>ID</th><th>名称</th><th>父级</th><th>备注</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    el.querySelector("#loc-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get("name"),
        note: fd.get("note") || "",
        parent_id: fd.get("parent_id") ? Number(fd.get("parent_id")) : null,
      };
      await api.post("/locations", payload);
      renderLocations();
    };

    el.querySelectorAll("button[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确认删除？子位置将提升一级")) return;
        await api.del(`/locations/${b.dataset.del}`);
        renderLocations();
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
