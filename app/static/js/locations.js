// 位置视图 v4：方块卡片 + 自研拖拽调整层级（自动保存）
//
// 为什么自研：本环境（远程/虚拟机等）HTML5 DnD 的 dragstart 不触发，
// SortableJS 的原生模式与 forceFallback 各组合均无法启动拖拽。
// 自研方案基于 Pointer/Mouse 事件 + 坐标命中检测，不依赖 HTML5 DnD，最可靠。
//
// 交互约定（缝隙选择区域）：
// - 按住卡片任意位置（按钮除外）拖动
// - 鼠标【上下】位置确定缝隙（两个条目之间），选择区域实时跟随鼠标
// - 区域内【左右】选择：左半 = 与上方条目同级，右半 = 成为上方条目的子级
// - 松手落在区域内执行放置，落在区域外则取消；松手自动保存，失败自动还原
import { api } from "./api.js";
import { buildLocTree, buildTreeOptions, escapeHtml, viewError, viewLoading } from "./utils.js";

// ===== 渲染 =====

export async function renderLocations() {
  const el = document.getElementById("view-locations");
  el.innerHTML = viewLoading("位置");
  try {
    // 并行拉位置 + 物品全量（分页），按 location_id 分组（卡片显示物品数/展开列表）
    const [locs, firstPage] = await Promise.all([
      api.get("/locations"),
      api.get("/items?page_size=100"),
    ]);
    let allItems = firstPage.items || [];
    if (firstPage.total > allItems.length) {
      const pages = Math.ceil(firstPage.total / 100);
      for (let p = 2; p <= pages; p++) {
        const d = await api.get(`/items?page_size=100&page=${p}`);
        allItems = allItems.concat(d.items || []);
      }
    }
    const itemsByLoc = {};
    for (const it of allItems) {
      if (it.location_id == null) continue;
      (itemsByLoc[it.location_id] = itemsByLoc[it.location_id] || []).push(it);
    }

    el.innerHTML = `
      <div class="loc-toolbar">
        <h2>位置</h2>
        <button id="loc-edit-toggle" class="loc-edit-btn" title="进入拖拽模式">✎ 编辑</button>
      </div>
      <div id="loc-status" class="msg" style="display:none"></div>
      <div id="loc-tree"></div>
    `;

    // 编辑模式开关：进入后卡片可拖拽调整层级，再点退出
    const editBtn = el.querySelector("#loc-edit-toggle");
    editBtn.textContent = editMode ? "✔ 完成" : "✎ 编辑";
    editBtn.classList.toggle("active", editMode);
    document.body.classList.toggle("loc-edit-mode", editMode);
    editBtn.onclick = () => {
      editMode = !editMode;
      document.body.classList.toggle("loc-edit-mode", editMode);
      editBtn.textContent = editMode ? "✔ 完成" : "✎ 编辑";
      editBtn.classList.toggle("active", editMode);
      if (editMode) showStatus("拖拽模式：按住卡片拖动调整层级，再点「完成」退出", false);
      else showStatus("", false);
    };

    const tree = buildLocTree(locs);
    const treeEl = el.querySelector("#loc-tree");
    // renderCards 只输出 li（不含 ul 包裹），外层 ul 在此统一生成，
    // 避免递归时产生 <ul class="loc-children"><ul class="loc-list"> 的畸形嵌套
    treeEl.innerHTML = tree.length
      ? `<ul class="loc-list">${renderCards(tree, itemsByLoc)}</ul>`
      : '<p class="muted">暂无位置，请添加</p>';

    // 卡片操作（事件委托）：添加子位置 / 删除 / 点击头部改名（非编辑模式）/ ▸ 展开物品
    treeEl.addEventListener("click", async (e) => {
      if (suppressClick) {
        suppressClick = false; // 拖拽后的 click 忽略
        return;
      }
      const addBtn = e.target.closest("[data-add-child]");
      if (addBtn) {
        e.stopPropagation();
        showInlineAdd(addBtn.closest(".loc-card"), Number(addBtn.dataset.addChild));
        return;
      }
      const btn = e.target.closest("[data-del]");
      if (btn) {
        if (!confirm("确认删除？子位置将提升一级")) return;
        await api.del(`/locations/${btn.dataset.del}`);
        renderLocations();
        return;
      }
      // ▸ 展开/收起该位置下的物品列表（两种模式都可用）
      const toggle = e.target.closest(".loc-toggle");
      if (toggle) {
        const card = toggle.closest(".loc-card");
        const itemsEl = card.querySelector(":scope > .loc-items");
        if (itemsEl) {
          const willShow = itemsEl.style.display !== "none";
          itemsEl.style.display = willShow ? "none" : "flex";
          card.classList.toggle("expanded", !willShow);
        }
        return;
      }
      // 点击卡片头部（非按钮，非编辑模式）：弹出改名
      const head = e.target.closest(".loc-head");
      if (head && !editMode) {
        e.stopPropagation();
        showRename(head.closest(".loc-card"));
      }
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
// 每张卡片显示【物品数量】，点击头部可展开该位置下的物品列表。
// 「家」（id=1）为固定根：不可删除（无 ✕），保留 + 添加子项目。
function renderCards(nodes, itemsByLoc) {
  if (!nodes.length) return "";
  let html = "";
  for (const node of nodes) {
    const items = itemsByLoc[node.id] || [];
    const isRoot = node.id === 1;
    html += `<li class="loc-card" data-id="${node.id}">
      <div class="loc-head">
        <span class="loc-toggle">▸</span>
        <span class="loc-handle" title="可拖拽">≡</span>
        <span class="loc-name">${escapeHtml(node.name)}</span>
        ${node.note ? `<span class="loc-note">— ${escapeHtml(node.note)}</span>` : ""}
        <span class="loc-count">${items.length} 件物品</span>
        <span class="loc-actions">
          <button class="loc-add" data-add-child="${node.id}" title="在此位置下添加子位置">+</button>
          ${isRoot ? "" : `<button class="loc-del" data-del="${node.id}" title="删除">✕</button>`}
        </span>
      </div>
      ${
        items.length
          ? `<ul class="loc-items">${items
              .map(
                (it) =>
                  `<li>
                     <span class="loc-item-name">${escapeHtml(it.name)}</span>
                     <span class="loc-item-qty">×${it.quantity}${it.unit || ""}</span>
                     <span class="loc-item-status">${escapeHtml(it.status || "")}</span>
                   </li>`
              )
              .join("")}</ul>`
          : ""
      }
      ${node.children.length ? `<ul class="loc-children">${renderCards(node.children, itemsByLoc)}</ul>` : ""}
    </li>`;
  }
  return html;
}
//
// ===== 自研拖拽（Mouse 事件 + 缝隙选择区域）=====
//
// 交互（用户确认的模型：先上下定位，再左右选择）：
//   1) 鼠标【上下】位置确定"缝隙"：把整棵树所有条目按视觉顺序视为同一级别，
//      鼠标在哪两个条目之间，就在那里显示一个选择区域（跟鼠标强关联，实时跟随）。
//   2) 区域内【左右】选择：左半 = 与上方条目同级（插入其后）；右半 = 成为上方条目的子级。
//   3) 松手：落在区域内按左右执行放置；落在区域外则取消。
//
// 关键设计（历史 bug 教训）：
//   - 选择区域 fixed 绝对定位（不插 DOM，不改变布局），pointer-events:none，
//     高亮与松手判定一律用坐标 + getBoundingClientRect（不依赖 elementFromPoint，
//     避免悬浮层干扰命中导致目标递归跳变）。

let drag = null; // { id, card, startX, startY, active, visual, zone, gapTarget, createdChildren }
let rafId = null;
let suppressClick = false; // 拖拽后抑制误触发的 click（防止拖完误展开物品列表）
let editMode = false; // 编辑模式（拖拽调层级）；默认关闭，点击卡片 = 改名

function onDragStart(e) {
  if (e.button !== 0) return; // 仅左键
  // 仅编辑模式可拖拽调整层级；默认模式点击 = 改名
  if (!editMode) return;
  suppressClick = false; // 新一轮按下重置
  const card = e.target.closest(".loc-card");
  if (!card) return;
  // 「家」（固定根，id=1）不可拖拽修改层级
  if (Number(card.dataset.id) === 1) return;
  // 卡片上的功能按钮不触发拖拽
  if (e.target.closest(".loc-add, .loc-del, .loc-inline-form")) return;

  drag = {
    id: Number(card.dataset.id),
    card,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    visual: null,
    zone: null, // 缝隙选择区域（fixed 定位，跟鼠标强关联）
    gapTarget: null, // 当前缝隙的上方条目 id
    createdChildren: [], // 本次拖拽中新建的空子级容器（取消时清理）
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
  if (!drag.active) {
    suppressClick = true; // 真正拖动了：抑制拖拽结束后的 click
    startDrag();
  }
  moveVisual(e.clientX, e.clientY);
  // rAF 节流：区域更新合并到下一帧
  if (rafId == null) {
    const x = e.clientX;
    const y = e.clientY;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      updateGapZone(x, y);
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
  // 缝隙选择区域：两个并排选项（左=同级、右=子级），fixed 定位由 updateGapZone 控制。
  // 防呆：若上次残留了区域，先移除，确保页面上只有一个。
  if (drag.zone) drag.zone.remove();
  const zone = document.createElement("div");
  zone.className = "loc-gap-zone";
  zone.innerHTML =
    '<span class="gap-opt" data-kind="after"></span>' +
    '<span class="gap-opt" data-kind="child"></span>';
  zone.style.position = "fixed";
  zone.style.pointerEvents = "none";
  zone.style.zIndex = "999";
  zone.style.display = "none";
  document.body.appendChild(zone);
  drag.zone = zone;
  // 直接存两个选项引用，避免每次 querySelector（防止误选导致文字/高亮错乱）
  drag.optAfter = zone.querySelector('[data-kind="after"]');
  drag.optChild = zone.querySelector('[data-kind="child"]');
}

function moveVisual(clientX, clientY) {
  if (!drag.visual) return;
  drag.visual.style.left = `${clientX + 10}px`;
  drag.visual.style.top = `${clientY + 10}px`;
}

// 更新缝隙选择区域：
//   - 区域【只在"空隙"显示】：鼠标落在某张卡片（项目框）上 → 隐藏区域（松手=取消）
//   - 鼠标在空隙 → 上方条目 A（head 底部最近）与下方条目 B（head 顶部最近）
//   - 区域显示在 A 与 B 之间（fixed 定位，跟鼠标强关联）
//   - 鼠标【左右】位置 → 左半高亮〔A 的同级〕、右半高亮〔A 的子级〕
function updateGapZone(clientX, clientY) {
  const zone = drag.zone;
  if (!zone) return;
  // 视觉顺序扫描所有条目 head（嵌套也按同一级别看待），
  // 同时判断鼠标是否在某张卡片（项目框）上。
  let insideCard = false;
  let above = null; // { id, name, head }
  let below = null;
  let bestAbove = Infinity;
  let bestBelow = Infinity;
  for (const card of document.querySelectorAll("#loc-tree .loc-card")) {
    const id = Number(card.dataset.id);
    if (id === drag.id) continue; // 自身不参与
    const head = card.querySelector(".loc-head").getBoundingClientRect();
    if (clientY >= head.top && clientY <= head.bottom) {
      insideCard = true; // 鼠标在项目框上：不显示区域
      break;
    }
    if (head.bottom <= clientY) {
      const d = clientY - head.bottom;
      if (d < bestAbove) {
        bestAbove = d;
        above = { id, name: card.querySelector(".loc-name")?.textContent || "该位置", head };
      }
    } else if (head.top >= clientY) {
      const d = head.top - clientY;
      if (d < bestBelow) {
        bestBelow = d;
        below = { id, name: card.querySelector(".loc-name")?.textContent || "该位置", head };
      }
    }
  }
  // 鼠标在卡片上，或树最上方（无上方条目）：隐藏区域
  if (insideCard || !above) {
    zone.style.display = "none";
    drag.gapTarget = null;
    return;
  }
  drag.gapTarget = above.id;
  // 区域位置：A 底部 ~ B 顶部（B 不存在时给固定高度）
  const top = above.head.bottom;
  const bottom = below ? below.head.top : top + 40;
  zone.style.display = "flex";
  zone.style.left = `${above.head.left}px`;
  zone.style.top = `${top}px`;
  zone.style.width = `${above.head.width}px`;
  zone.style.height = `${Math.max(bottom - top, 28)}px`;
  // 选项文字与左右高亮（用已存引用）
  const midX = above.head.left + above.head.width / 2;
  // 「家」（id=1）固定最上层：不可作为"同级"目标（只能收子级），左框禁用
  const rootNoSame = above.id === 1;
  if (drag.optAfter) {
    drag.optAfter.textContent = rootNoSame ? "家 的子级" : `${above.name} 的同级`;
    drag.optAfter.classList.toggle("disabled", rootNoSame);
    drag.optAfter.classList.toggle("active", !rootNoSame && clientX <= midX);
  }
  if (drag.optChild) {
    drag.optChild.textContent = `${above.name} 的子级`;
    drag.optChild.classList.toggle("disabled", false);
    drag.optChild.classList.toggle("active", clientX > midX || rootNoSame);
  }
}

function onDragEnd(e) {
  if (!drag) return;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  const state = drag;
  drag = null;
  // 注意：不在这里移除 body.loc-dragging（保持卡片间距拉开状态）——
  // 若过早移除，滑入动画期间间距会收回，造成"下方整体上提"。
  // 间距在落位动画完成后（animateInsert 末尾）再收回。
  state.card.classList.remove("dragging");

  // 松手：坐标判断是否落在选择区域内；区域左半=同级(after)，右半=子级(child)
  let target = null;
  if (state.active && state.gapTarget != null && state.zone) {
    const r = state.zone.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const kind = e.clientX <= r.left + r.width / 2 ? "after" : "child";
      // 「家」（id=1）固定最上层：落在它的"同级"（左半）→ 取消（只允许子级）
      if (!(state.gapTarget === 1 && kind === "after")) {
        target = { targetId: state.gapTarget, kind };
      }
    }
  }
  if (state.zone) state.zone.remove(); // 移除选择区域
  if (!target) {
    // 取消：收回间距，移除跟随层，清理拖拽中新建的空子级容器（无卡片）；不要动被拖卡片原有子级
    document.body.classList.remove("loc-dragging");
    if (state.visual) state.visual.remove();
    for (const ul of state.createdChildren) {
      if (!ul.isConnected || !ul.querySelector(":scope > .loc-card")) ul.remove();
    }
    return;
  }
  // 放置成功：先做落位动画（间距拉大 → 跟随层滑入），动画完成后再真正放置保存
  animateInsert(state, target);
}

// 落位动画：目标位置先撑开恰好容纳卡片的空隙（间距调整好），跟随层再滑入占位位置，
// 动画完成后移除占位与跟随层，调用 commitDrag 真正放置并保存。
function animateInsert(state, target) {
  const targetCard = document.querySelector(`.loc-card[data-id="${target.targetId}"]`);
  if (!targetCard) {
    if (state.visual) state.visual.remove();
    commitDrag({ card: state.card, id: state.id, targetId: target.targetId, kind: target.kind });
    return;
  }
  // 卡片可视高度（head 高度；li 含子级不能用 offsetHeight）
  const headH = state.card.querySelector(".loc-head")?.offsetHeight || 46;
  // 1) 目标位置插入占位 li（高度 = 卡片高度，无撑开动画，直接预留好空间）
  const holder = document.createElement("li");
  holder.className = "loc-insert-holder";
  holder.style.height = `${headH}px`;
  if (target.kind === "child") {
    let children = targetCard.querySelector(":scope > .loc-children");
    if (!children) {
      children = document.createElement("ul");
      children.className = "loc-children";
      targetCard.appendChild(children);
    }
    children.prepend(holder);
  } else {
    targetCard.after(holder);
  }
  // 2) 立即收回卡片间距（0.5s 过渡，提前完成；滑入是最后一步动画）
  document.body.classList.remove("loc-dragging");
  // 3) 收回开始后（500ms）：先隐藏原位置卡片（原位置平滑补位），
  //    再把跟随层定位到占位【正右方】水平滑入（2.5s）。
  //    最终定格位置上移 4px（用户实测的固定错位量，滑入定格 = 落位位置）。
  const visual = state.visual;
  setTimeout(() => {
    // 原位置卡片隐藏 → 下方卡片平滑补位（margin 过渡），避免滑入结束才跳变
    state.card.style.display = "none";
    // 滑入期间隐藏虚线占位框（保留空间，只去掉边框视觉）
    holder.style.visibility = "hidden";
    if (visual && holder.isConnected) {
      const r = holder.getBoundingClientRect();
      // 瞬间定位到占位正右侧（垂直比占位高 4px、水平贴右），宽度也对齐占位
      visual.style.transition = "none";
      visual.style.left = `${r.right + 8}px`;
      visual.style.top = `${r.top - 4}px`;
      visual.style.width = `${r.width}px`;
      // 强制重排后，加过渡从右向左滑入占位（0.5s，只水平移动，top 保持上移 4px）
      void visual.offsetWidth;
      visual.style.transition = "left 0.5s ease";
      visual.style.left = `${r.left}px`;
    }
  }, 500);
  // 4) 滑入完成：移除占位与跟随层，真正放置 + 保存（无后续动画）
  setTimeout(async () => {
    holder.remove();
    if (visual) visual.remove();
    await commitDrag({ card: state.card, id: state.id, targetId: target.targetId, kind: target.kind });
  }, 500 + 700);
}

// 提交：把被拖卡片按选择类型插入目标卡片下 → 收集 DOM → 环检测 → 提交 reorder
async function commitDrag(state) {
  const targetCard = document.querySelector(`.loc-card[data-id="${state.targetId}"]`);
  if (!targetCard) {
    renderLocations();
    return;
  }
  if (state.kind === "child") {
    // 成为目标卡片的子级（子级列表顶部；无容器则创建）
    let children = targetCard.querySelector(":scope > .loc-children");
    if (!children) {
      children = document.createElement("ul");
      children.className = "loc-children";
      targetCard.appendChild(children);
    }
    children.prepend(state.card);
  } else {
    // 同级：插入目标卡片之后
    targetCard.after(state.card);
  }
  // 滑入动画期间原位置卡片被隐藏（display:none），放置后恢复显示
  state.card.style.display = "";
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

  let saved = false;
  try {
    const r = await api.put("/locations/reorder", items);
    saved = true; // 成功：静默，不提示（用户要求）
  } catch (err) {
    showStatus("保存失败：" + err.message + "，已还原", true);
  }
  // 保存成功：DOM 已是最终结构，不重渲染（避免闪动/布局跳变）；
  // 保存失败：重渲染还原为服务端状态。
  if (!saved) await renderLocations();
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

// ===== 内联改名 =====

function showRename(card) {
  const existing = card.querySelector(".loc-inline-form");
  if (existing) {
    existing.remove();
    return;
  }
  const id = Number(card.dataset.id);
  const nameEl = card.querySelector(".loc-name");
  const wrap = document.createElement("div");
  wrap.className = "loc-inline-form";
  wrap.innerHTML = `
    <form class="card" style="padding:8px;gap:8px;margin-top:8px">
      <input name="name" placeholder="位置名称" value="${escapeHtml(nameEl.textContent)}" required />
      <button type="submit">保存</button>
      <button type="button" class="loc-inline-cancel ghost">取消</button>
    </form>`;
  card.querySelector(".loc-head").after(wrap);
  const form = wrap.querySelector("form");
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    await api.put(`/locations/${id}`, { name: fd.get("name") });
    renderLocations();
  };
  wrap.querySelector(".loc-inline-cancel").onclick = () => wrap.remove();
  form.querySelector("[name=name]").focus();
  form.querySelector("[name=name]").select();
}
