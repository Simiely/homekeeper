// 位置视图：可视化层级树 + 新增 + 删除
import { api } from "./api.js";

export async function renderLocations() {
  const el = document.getElementById("view-locations");
  el.innerHTML = "<h2>位置</h2><div class='loading'>加载中…</div>";
  try {
    const locs = await api.get("/locations");

    // 构建内存树
    const tree = buildTree(locs);

    // 生成缩进选项（供新增表单的父级选择器用）
    const indentOpts = buildOptions(tree);

    el.innerHTML = `
      <h2>位置（层级树）</h2>
      <form id="loc-form" class="card">
        <input name="name" placeholder="位置名称" required />
        <select name="parent_id">
          <option value="">— 顶级位置 —</option>
          ${indentOpts}
        </select>
        <input name="note" placeholder="备注" />
        <button type="submit">添加</button>
      </form>
      <div id="loc-tree">${renderTreeHtml(tree)}</div>
    `;

    // 新增表单
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

    // 删除按钮（委托）
    el.querySelector("#loc-tree").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      if (!confirm("确认删除？子位置将提升一级")) return;
      await api.del(`/locations/${btn.dataset.del}`);
      renderLocations();
    });
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

// ---- 树构建 ----

function buildTree(locations) {
  const lookup = {};
  locations.forEach((l) => (lookup[l.id] = { ...l, children: [] }));
  const roots = [];
  locations.forEach((l) => {
    if (l.parent_id === null) roots.push(lookup[l.id]);
    else if (lookup[l.parent_id])
      lookup[l.parent_id].children.push(lookup[l.id]);
  });
  return roots;
}

// ---- 递归渲染 HTML ----

function renderTreeHtml(nodes) {
  if (!nodes.length) return '<p class="muted">暂无位置，请添加</p>';
  let html = '<ul class="tree">';
  for (const node of nodes) {
    const icon = node.children.length
      ? '<span class="tree-icon">▾</span>'
      : '<span class="tree-icon">○</span>';
    html += `<li>
        ${icon}
        <span class="tree-name">${escapeHtml(node.name)}</span>
        ${node.note ? `<span class="tree-note">— ${escapeHtml(node.note)}</span>` : ""}
        <button class="tree-btn" data-del="${node.id}">删</button>
      </li>`;
    if (node.children.length) {
      html += `<li style="padding:0">${renderTreeHtml(node.children)}</li>`;
    }
  }
  html += "</ul>";
  return html;
}

// ---- 缩进选项（用于父级下拉） ----

function buildOptions(nodes, depth = 0, excludeId = null) {
  let html = "";
  for (const node of nodes) {
    if (node.id === excludeId) continue;
    const prefix = depth > 0 ? "　".repeat(depth) + "├── " : "";
    html += `<option value="${node.id}">${prefix}${escapeHtml(node.name)}</option>`;
    if (node.children.length) {
      html += buildOptions(node.children, depth + 1, excludeId);
    }
  }
  return html;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
