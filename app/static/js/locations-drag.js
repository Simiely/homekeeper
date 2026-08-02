// 位置拖拽（自研 Pointer 事件 + 缝隙选择区域）：独立模块
//
// 交互模型（用户确认：先上下定位缝隙，再左右选择）：
//   1) 指针【上下】位置确定"缝隙"：整棵树所有条目按视觉顺序视为同一级别，
//      指针在哪两个条目之间，就显示一个选择区域（fixed 定位，跟指针强关联）。
//   2) 区域内【左右】选择：左半 = 与上方条目同级；右半 = 成为上方条目的子级。
//   3) 松手：落在区域内按左右执行放置；区域外取消。自动保存，失败还原。
//
// 与渲染层解耦：通过 initDrag(hooks) 注入回调
//   isEditMode() -> bool     是否编辑模式（仅编辑模式可拖）
//   onRename(card)           编辑模式单击卡片 = 改名
//   onStatus(msg, isError, keep)  状态提示
//   onRender()               失败时重渲染还原
import { api } from "./api.js";

let drag = null; // { id, card, startX, startY, active, visual, zone, gapTarget, createdChildren }
let rafId = null;
let suppressClick = false; // 拖拽后抑制误触发的 click（防止拖完误展开物品列表）
let dragScrollTimer = null;

const DRAG_EDGE = 80; // 距视口边缘多少 px 触发自动滚动（更大=更早触发）
const DRAG_SCROLL_STEP = 26; // 每帧（约 16ms）滚动像素（越快滚动越跟手）

let hooks = {
  isEditMode: () => false,
  onRename: () => {},
  onStatus: () => {},
  onRender: () => {},
};

// 渲染层注册回调（模块加载时调用一次）
export function initDrag(cb) {
  hooks = { ...hooks, ...cb };
}

// 渲染层 click 委托调用：消费"拖拽后抑制点击"标记
export function consumeSuppress() {
  const v = suppressClick;
  suppressClick = false;
  return v;
}

// 渲染层绑定拖拽入口（每次重建 #loc-tree 后调用）
export function attachDrag(treeEl) {
  treeEl.addEventListener("pointerdown", onDragStart);
}

function onDragStart(e) {
  // 触屏（pointerType 为 touch/pen）没有 button 语义，仅鼠标限制左键
  if (e.pointerType === "mouse" && e.button !== 0) return;
  // 仅编辑模式可拖拽调整层级；默认模式点击 = 改名
  if (!hooks.isEditMode()) return;
  suppressClick = false; // 新一轮按下重置
  const card = e.target.closest(".loc-card");
  if (!card) return;
  // 卡片上的功能按钮不触发拖拽/单击改名
  if (e.target.closest(".loc-add, .loc-del, .loc-inline-form, .loc-toggle")) return;
  // 触屏关键：立即用内联样式锁定 body 的 touch-action，防止触摸被浏览器判为滚动
  // → pointercancel 中断拖拽（内联样式在触摸序列开始前生效最稳）
  document.body.style.touchAction = "none";
  document.body.style.userSelect = "none";

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
  // 触屏防滚动：捕获阶段阻止 touchmove 默认行为（浏览器滚动会触发 pointercancel 中断拖拽）
  document.addEventListener(
    "touchmove",
    (drag.touchGuard = (ev) => ev.preventDefault()),
    { passive: false, capture: true }
  );
  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointerup", onDragEnd);
  document.addEventListener("pointercancel", onDragEnd);
}

// 拖拽边缘自动滚动：触屏拖拽时手指移到视口上/下边缘附近，页面跟随滚动，
// 使超出当前屏幕的目标位置也能被拖到（拖拽期间 touch-action 已锁定，浏览器不会自行滚动）
function autoScroll(clientY) {
  const vh = window.innerHeight || document.documentElement.clientHeight;
  let delta = 0;
  if (clientY < DRAG_EDGE) {
    delta = -((DRAG_EDGE - clientY) / DRAG_EDGE) * DRAG_SCROLL_STEP;
  } else if (clientY > vh - DRAG_EDGE) {
    delta = ((clientY - (vh - DRAG_EDGE)) / DRAG_EDGE) * DRAG_SCROLL_STEP;
  }
  if (delta === 0) {
    stopAutoScroll();
    return;
  }
  if (!dragScrollTimer) {
    dragScrollTimer = setInterval(() => {
      window.scrollBy(0, delta);
      // 滚动后缝隙选择区域需按最新指针位置重算（fixed 区域不会自动跟随条目移动）
      if (drag && drag.lastX != null && drag.zone) {
        updateGapZone(drag.lastX, drag.lastY);
      }
    }, 16);
  }
}

function stopAutoScroll() {
  if (dragScrollTimer) {
    clearInterval(dragScrollTimer);
    dragScrollTimer = null;
  }
}

function onDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  // 移动 6px 判定为拖拽（避免点击误触发）
  if (!drag.active && Math.hypot(dx, dy) < 6) return;
  // 「家」（固定根，id=1）不可拖拽修改层级：超阈值直接取消本次拖拽（单击改名仍正常）
  if (drag.id === 1) {
    cancelDrag();
    return;
  }
  if (!drag.active) {
    suppressClick = true; // 真正拖动了：抑制拖拽结束后的 click
    startDrag();
  }
  moveVisual(e.clientX, e.clientY);
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  autoScroll(e.clientY);
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
//   - 区域【只在"空隙"显示】：指针落在某张卡片（项目框）上 → 隐藏区域（松手=取消）
//   - 指针在空隙 → 上方条目 A（head 底部最近）与下方条目 B（head 顶部最近）
//   - 区域显示在 A 与 B 之间（fixed 定位，跟指针强关联）
//   - 指针【左右】位置 → 左半高亮〔A 的同级〕、右半高亮〔A 的子级〕
function updateGapZone(clientX, clientY) {
  const zone = drag.zone;
  if (!zone) return;
  // 视觉顺序扫描所有条目 head（嵌套也按同一级别看待），
  // 同时判断指针是否在某张卡片（项目框）上。
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
      insideCard = true; // 指针在项目框上：不显示区域
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
  // 指针在卡片上，或树最上方（无上方条目）：隐藏区域
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

// 取消本次拖拽：清理监听与视觉残留（供「家」不可拖时调用；也用于 pointercancel）
function cancelDrag() {
  if (!drag) return;
  stopAutoScroll();
  document.removeEventListener("pointermove", onDragMove);
  document.removeEventListener("pointerup", onDragEnd);
  document.removeEventListener("pointercancel", onDragEnd);
  if (drag.touchGuard) {
    document.removeEventListener("touchmove", drag.touchGuard, { capture: true });
  }
  resetDragBody();
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  document.body.classList.remove("loc-dragging");
  if (drag.visual) drag.visual.remove();
  if (drag.zone) drag.zone.remove();
  for (const ul of drag.createdChildren) {
    if (!ul.isConnected || !ul.querySelector(":scope > .loc-card")) ul.remove();
  }
  drag.card.classList.remove("dragging");
  drag = null;
}

function onDragEnd(e) {
  if (!drag) return;
  stopAutoScroll();
  document.removeEventListener("pointermove", onDragMove);
  document.removeEventListener("pointerup", onDragEnd);
  document.removeEventListener("pointercancel", onDragEnd);
  if (drag.touchGuard) {
    document.removeEventListener("touchmove", drag.touchGuard, { capture: true });
  }
  resetDragBody();
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  const state = drag;
  drag = null;
  // pointercancel（触屏被系统打断）没有可靠的 clientX/clientY → 按取消处理
  if (e.type === "pointercancel" || e.clientX == null || e.clientY == null) {
    document.body.classList.remove("loc-dragging");
    if (state.visual) state.visual.remove();
    if (state.zone) state.zone.remove();
    for (const ul of state.createdChildren) {
      if (!ul.isConnected || !ul.querySelector(":scope > .loc-card")) ul.remove();
    }
    state.card.classList.remove("dragging");
    return;
  }
  // 编辑模式下「单击」卡片（按下后未拖动超过阈值）＝ 改名
  if (!state.active) {
    hooks.onRename(state.card);
    return;
  }
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

// 恢复拖拽期间锁定的 body 样式（触屏 touch-action 锁定 + 文字选中禁止）
function resetDragBody() {
  document.body.style.touchAction = "";
  document.body.style.userSelect = "";
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
    hooks.onRender();
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
    hooks.onRender();
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
    hooks.onStatus("不能移动到自己的子级下", true);
    hooks.onRender();
    return;
  }

  let saved = false;
  try {
    await api.put("/locations/reorder", items);
    saved = true; // 成功：静默，不提示（用户要求）
  } catch (err) {
    hooks.onStatus("保存失败：" + err.message + "，已还原", true);
  }
  // 保存成功：DOM 已是最终结构，不重渲染（避免闪动/布局跳变）；
  // 保存失败：重渲染还原为服务端状态。
  if (!saved) await hooks.onRender();
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
