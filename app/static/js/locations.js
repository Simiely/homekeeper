// 位置视图 v4：方块卡片 + 自研拖拽调整层级（自动保存）
//
// 为什么自研：本环境（远程/虚拟机等）HTML5 DnD 的 dragstart 不触发，
// SortableJS 的原生模式与 forceFallback 各组合均无法启动拖拽。
// 自研方案基于 Pointer/Mouse 事件 + 坐标命中检测，不依赖 HTML5 DnD，最可靠。
//
// 交互约定（缝隙模型）：
// - 按住卡片任意位置（按钮除外）拖动
// - 拖到两卡之间（靠近某卡顶部/底部边界）= 插入同级（前/后）
// - 拖到卡片左侧缩进区 = 成为其子级
// - 拖拽中卡片间距自动拉宽（放置更从容），虚线占位框预示插入位置
// - 松手自动保存，失败自动还原
import { api } from "./api.js";
import { buildLocTree, buildTreeOptions, escapeHtml, viewError, viewLoading } from "./utils.js";

// ===== 渲染 =====

export async function renderLocations() {
  const el = document.getElementById("view-locations");
  el.innerHTML = viewLoading("位置");
  try {
    const locs = await api.get("/locations");

    el.innerHTML = `
      <h2>位置（拖拽卡片调整层级）</h2>
      <p class="muted" style="margin:0 0 10px">按住卡片拖动：拖到两卡<b>之间</b>=插入同级，拖到卡片<b>左侧缩进区</b>=成为其子级。松手自动保存。</p>
      <form id="loc-form" class="card">
        <input name="name" placeholder="位置名称" required />
        <select name="parent_id">
          <option value="">— 顶级位置 —</option>
          ${buildTreeOptions(locs)}
        </select>
        <input name="note" placeholder="备注" />
        <button type="submit">添加</button>
      </form>
      <div id="loc-status" class="msg" style="display:none"></div>
      <div id="loc-tree"></div>
    `;

    const tree = buildLocTree(locs);
    const treeEl = el.querySelector("#loc-tree");
    // renderCards 只输出 li（不含 ul 包裹），外层 ul 在此统一生成，
    // 避免递归时产生 <ul class="loc-children"><ul class="loc-list"> 的畸形嵌套
    treeEl.innerHTML = tree.length
      ? `<ul class="loc-list">${renderCards(tree)}</ul>`
      : '<p class="muted">暂无位置，请添加</p>';

    // 新增表单
    el.querySelector("#loc-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api.post("/locations", {
        name: fd.get("name"),
        note: fd.get("note") || "",
        parent_id: fd.get("parent_id") ? Number(fd.get("parent_id")) : null,
      });
      renderLocations();
    };

    // 卡片操作（事件委托）
    treeEl.addEventListener("click", async (e) => {
      const addBtn = e.target.closest("[data-add-child]");
      if (addBtn) {
        e.stopPropagation();
        showInlineAdd(addBtn.closest(".loc-card"), Number(addBtn.dataset.addChild));
        return;
      }
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      if (!confirm("确认删除？子位置将提升一级")) return;
      await api.del(`/locations/${btn.dataset.del}`);
      renderLocations();
    });

    // 自研拖拽：mousedown 委托
    treeEl.addEventListener("mousedown", onDragStart);
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}

// ---- 方块卡片渲染（递归）----
// 注意：只返回 <li> 列表，不包裹 <ul>；<ul class="loc-list"> 由调用处生成，
// 子级 <ul class="loc-children"> 在此生成（内部仍是 li，不会再套 ul）。
function renderCards(nodes) {
  if (!nodes.length) return "";
  let html = "";
  for (const node of nodes) {
    html += `<li class="loc-card" data-id="${node.id}">
      <div class="loc-head">
        <span class="loc-handle" title="可拖拽">≡</span>
        <span class="loc-name">${escapeHtml(node.name)}</span>
        ${node.note ? `<span class="loc-note">— ${escapeHtml(node.note)}</span>` : ""}
        ${node.children.length ? `<span class="loc-count">${node.children.length} 子位置</span>` : ""}
        <span class="loc-actions">
          <button class="loc-add" data-add-child="${node.id}" title="在此位置下添加子位置">+</button>
          <button class="loc-del" data-del="${node.id}" title="删除">✕</button>
        </span>
      </div>
      ${node.children.length ? `<ul class="loc-children">${renderCards(node.children)}</ul>` : ""}
    </li>`;
  }
  return html;
}

// ===== 自研拖拽（Mouse 事件 + 插入占位预览）=====
//
// 流程：mousedown 记录起点 → 移动 6px 启动拖拽 → mousemove 更新跟随层与占位框
// （rAF 节流）→ mouseup 用占位位置替换被拖卡片 → 收集 DOM 提交 /api/locations/reorder。
// 判定为"缝隙模型"：只找鼠标最近的卡片顶部/底部边界（上下相邻元素之间），
// 左侧缩进区判定为子级；判定不变（滞回）则不移动占位，避免反复横跳。

let drag = null; // { id, card, startX, startY, active, visual, ph, placement }
let rafId = null;

function onDragStart(e) {
  if (e.button !== 0) return; // 仅左键
  const card = e.target.closest(".loc-card");
  if (!card) return;
  // 按钮区域不触发拖拽
  if (e.target.closest(".loc-add, .loc-del, .loc-inline-form")) return;

  drag = {
    id: Number(card.dataset.id),
    card,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    visual: null,
    ph: null,
    placement: null, // 上次判定的插入位置（滞回用）
  };
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  // 移动 6px 判定为拖拽（避免点击误触发）
  if (!drag.active && Math.hypot(dx, dy) < 6) return;
  if (!drag.active) startDrag();
  moveVisual(e.clientX, e.clientY);
  // rAF 节流：占位判定合并到下一帧，避免 mousemove 高频触发 reflow
  if (rafId == null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      updatePlaceholder(e.clientX, e.clientY);
    });
  }
}

function startDrag() {
  drag.active = true;
  drag.card.classList.add("dragging");
  document.body.classList.add("loc-dragging");
  // 自绘跟随层（单条卡片，去掉子级）
  const clone = drag.card.cloneNode(true);
  clone.classList.add("loc-drag-visual");
  const children = clone.querySelector(".loc-children");
  if (children) children.remove();
  clone.style.position = "fixed";
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "1000";
  clone.style.width = `${drag.card.offsetWidth}px`;
  document.body.appendChild(clone);
  drag.visual = clone;
  // 插入占位框（pointer-events:none，不干扰命中检测）
  const ph = document.createElement("li");
  ph.className = "loc-insert-ph";
  ph.style.pointerEvents = "none";
  drag.ph = ph;
}

function moveVisual(clientX, clientY) {
  if (!drag.visual) return;
  drag.visual.style.left = `${clientX + 10}px`;
  drag.visual.style.top = `${clientY + 10}px`;
}

// 命中判定：缝隙模型（只判断鼠标最近的卡片边界，即"上下两个相邻元素之间"）
//   - 鼠标离某卡片顶部最近 → 插入该卡片之前（同级）
//   - 鼠标离某卡片底部最近 → 插入该卡片之后（同级）
//   - 鼠标在卡片左侧缩进区（竖向在卡片内）→ 成为该卡片子级
function computePlacement(clientX, clientY) {
  const cards = document.querySelectorAll("#loc-tree .loc-card");
  let best = null;
  let bestDist = Infinity;
  for (const card of cards) {
    const id = Number(card.dataset.id);
    if (id === drag.id) continue; // 自身不参与
    const rect = card.getBoundingClientRect();
    // 缝隙：卡片顶部（插前）/ 底部（插后）
    const dTop = Math.abs(clientY - rect.top);
    if (dTop < bestDist) {
      bestDist = dTop;
      best = { type: "before", cardId: id };
    }
    const dBottom = Math.abs(clientY - rect.bottom);
    if (dBottom < bestDist) {
      bestDist = dBottom;
      best = { type: "after", cardId: id };
    }
    // 子级：鼠标在卡片左侧缩进区（且竖向在卡片内）
    if (clientX < rect.left + 46 && clientY > rect.top + 4 && clientY < rect.bottom - 4) {
      const dChild = Math.hypot(clientX - (rect.left + 20), clientY - (rect.top + rect.height / 2));
      if (dChild < bestDist) {
        bestDist = dChild;
        best = { type: "child", cardId: id };
      }
    }
  }
  return best;
}

function samePlacement(a, b) {
  if (!a || !b) return a === b;
  return a.type === b.type && a.cardId === b.cardId;
}

// 更新占位框位置（预示最终插入位置；判定不变则不动，避免占位反复横跳）
function updatePlaceholder(clientX, clientY) {
  if (!drag.ph) return;
  const placement = computePlacement(clientX, clientY);
  if (samePlacement(placement, drag.placement)) return;
  drag.placement = placement;
  const ph = drag.ph;
  ph.remove(); // 移出旧位置（不重播动画，避免卡顿）
  if (!placement) return;
  const targetCard = document.querySelector(`.loc-card[data-id="${placement.cardId}"]`);
  if (!targetCard) return;
  if (placement.type === "before") {
    targetCard.before(ph);
  } else if (placement.type === "after") {
    targetCard.after(ph);
  } else {
    // 子级：插入目标卡片子级列表顶部（无容器则创建）
    let children = targetCard.querySelector(":scope > .loc-children");
    if (!children) {
      children = document.createElement("ul");
      children.className = "loc-children";
      targetCard.appendChild(children);
    }
    children.prepend(ph);
  }
}

function onDragEnd() {
  if (!drag) return;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  const state = drag;
  drag = null;
  document.body.classList.remove("loc-dragging");
  if (state.visual) state.visual.remove();
  state.card.classList.remove("dragging");

  // 未启动或占位未插入：取消（清理可能新建的空子容器）
  if (!state.active || !state.ph || !state.ph.isConnected) {
    state.card.querySelector(":scope > .loc-children")?.remove();
    return;
  }
  commitDrag(state);
}

// 提交：占位被被拖卡片替换（DOM 即最终结构）→ 收集 → 提交 reorder
async function commitDrag(state) {
  // 把被拖卡片移到占位位置
  state.ph.replaceWith(state.card);
  const items = collectFlat();
  const dragged = items.find((i) => i.id === state.id);
  if (!dragged) {
    renderLocations();
    return;
  }

  // 环检测：新父级不能是自己的后代
  const descendants = new Set();
  const collect = (pid) => {
    for (const it of items) {
      if (it.parent_id === pid && !descendants.has(it.id)) {
        descendants.add(it.id);
        collect(it.id);
      }
    }
  };
  collect(state.id);
  if (dragged.parent_id !== null && descendants.has(dragged.parent_id)) {
    showStatus("不能移动到自己的子级下", true);
    renderLocations();
    return;
  }

  try {
    const r = await api.put("/locations/reorder", items);
    showStatus(`已保存位置层级（${r.updated} 项）`, false);
  } catch (err) {
    showStatus("保存失败：" + err.message + "，已还原", true);
  }
  renderLocations();
}

// 从当前 DOM 收集扁平结构（id, parent_id, sort_order）
function collectFlat() {
  const flat = [];
  const walk = (ul, parentId) => {
    let order = 0;
    for (const card of ul.children) {
      if (!card.classList || !card.classList.contains("loc-card")) continue;
      flat.push({ id: Number(card.dataset.id), parent_id: parentId, sort_order: order++ });
      for (const child of card.children) {
        if (child.classList && child.classList.contains("loc-children")) walk(child, Number(card.dataset.id));
      }
    }
  };
  const root = document.querySelector("#loc-tree > .loc-list");
  if (root) walk(root, null);
  return flat;
}

function showStatus(msg, isError) {
  const status = document.getElementById("loc-status");
  if (!status) return;
  status.textContent = msg;
  status.style.display = "";
  status.style.color = isError ? "var(--danger)" : "var(--accent)";
  setTimeout(() => (status.style.display = "none"), 2500);
}

// ===== 内联添加子位置 =====

function showInlineAdd(card, parentId) {
  const existing = card.querySelector(".loc-inline-form");
  if (existing) {
    existing.remove();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "loc-inline-form";
  wrap.innerHTML = `
    <form class="card" style="padding:8px;gap:8px;margin-top:8px">
      <input name="name" placeholder="子位置名称" required />
      <input name="note" placeholder="备注（可选）" />
      <button type="submit">添加</button>
      <button type="button" class="loc-inline-cancel ghost">取消</button>
    </form>`;
  card.querySelector(".loc-head").after(wrap);
  const form = wrap.querySelector("form");
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    await api.post("/locations", {
      name: fd.get("name"),
      note: fd.get("note") || "",
      parent_id: parentId,
    });
    renderLocations();
  };
  wrap.querySelector(".loc-inline-cancel").onclick = () => wrap.remove();
  form.querySelector("[name=name]").focus();
}
