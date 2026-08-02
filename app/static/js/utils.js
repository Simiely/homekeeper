// 全局共用工具函数
import { api } from "./api.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// 今天日期字符串（YYYY-MM-DD，本地时区）
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 构建位置路径函数：传入全量 locations，返回 (id) => "家 > 厨房 > 冰箱" | null
export function buildLocPath(locations) {
  const parentMap = Object.fromEntries(locations.map((l) => [l.id, l.parent_id]));
  const nameMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  return (id) => {
    if (!id) return null;
    const parts = [];
    let cur = id;
    while (cur && nameMap[cur]) {
      parts.unshift(nameMap[cur]);
      cur = parentMap[cur];
    }
    return parts.join(" > ");
  };
}

// 批量操作物品：归档/删除/改状态/改分类（POST /items/batch）
export async function batchItems(ids, action, extra = {}) {
  return api.post("/items/batch", { item_ids: ids, action, ...extra });
}

// 统一视图模板：加载中 / 错误（所有视图模块共用，保证交互一致）
export function viewLoading(title = "") {
  return title ? `<h2>${escapeHtml(title)}</h2><div class="loading">加载中…</div>` : `<div class="loading">加载中…</div>`;
}

export function viewError(msg) {
  return `<p class="err">${escapeHtml(msg)}</p>`;
}

export function buildLocTree(locations) {
  const lookup = {};
  locations.forEach((l) => (lookup[l.id] = { ...l, children: [] }));
  const roots = [];
  locations.forEach((l) => {
    if (l.parent_id === null) roots.push(lookup[l.id]);
    else if (lookup[l.parent_id]) lookup[l.parent_id].children.push(lookup[l.id]);
  });
  return roots;
}

export function buildTreeOptions(locations, placeholder) {
  const tree = buildLocTree(locations);
  let html = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const prefix = depth > 0 ? "　".repeat(depth) + "├── " : "";
      html += `<option value="${node.id}">${prefix}${escapeHtml(node.name)}</option>`;
      if (node.children.length) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return html;
}
