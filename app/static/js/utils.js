// 全局共用工具函数
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
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
