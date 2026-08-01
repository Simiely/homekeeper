// 拖拽模拟 v2：完整父子关系对比 + hover 截图 + 拖拽中状态
const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const APP_URL = "http://127.0.0.1:8000/";
const OUT_DIR = path.resolve(__dirname, "shots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  await page.type("#username", "admin");
  await page.type("#password", "Mm123456.");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
    page.click("#submit-btn"),
  ]);
  await sleep(1000);
  await page.waitForSelector('[data-view="locations"]', { timeout: 10000 });
  await page.click('[data-view="locations"]');
  await page.waitForSelector(".loc-card", { timeout: 10000 });
  await sleep(1000);
}

async function getStructure(page) {
  return page.evaluate(() => {
    const map = {};
    document.querySelectorAll("#loc-tree .loc-card").forEach((c) => {
      map[c.dataset.id] = {
        id: c.dataset.id,
        name: c.querySelector(".loc-name")?.textContent || "?",
        parentId: c.parentElement.classList.contains("loc-children")
          ? c.parentElement.parentElement.dataset.id
          : null,
      };
    });
    return map;
  });
}

function printStructure(map, title) {
  console.log(`\n${title}`);
  const roots = Object.values(map).filter((c) => c.parentId === null);
  const printTree = (node, indent) => {
    console.log("  ".repeat(indent) + `#${node.id} ${node.name}`);
    Object.values(map).filter((c) => c.parentId === node.id).forEach((c) => printTree(c, indent + 1));
  };
  roots.forEach((r) => printTree(r, 0));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const logs = [];
  const badReqs = [];
  page.on("console", (msg) => {
    const t = msg.type();
    if (["error", "warning"].includes(t)) logs.push(`[${t}] ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message.slice(0, 300)}`));
  page.on("response", (resp) => {
    const s = resp.status();
    const url = resp.url();
    if (s >= 400 && !url.includes("login") && !url.includes("favicon")) badReqs.push(`[${s}] ${url.slice(0, 150)}`);
  });

  console.log("===== 登录 + 进入位置页 =====");
  await login(page);

  const beforeMap = await getStructure(page);
  printStructure(beforeMap, "拖拽前结构:");

  // 拖拽：玄关(#5) → 拖到书房(#6) 上方位置（target.y = 书房 head 顶部 - 8，进上方缝隙）
  const from = await page.evaluate(() => {
    const c = document.querySelector('.loc-card[data-id="5"] .loc-head');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const to = await page.evaluate(() => {
    // 拖到书房的上方缝隙：书房 head.top - 12（在「厨房」和「书房」之间）
    const c = document.querySelector('.loc-card[data-id="6"] .loc-head');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top - 12 };
  });
  console.log(`\n拖拽: (${from.x},${from.y}) → (${to.x},${to.y})`);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // 慢速轨迹 20 步
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await sleep(20);
  }
  // 停留 500ms 让选择区域出现
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, "Z-hover.png") });

  // 抓取拖拽时的 zone 状态
  const zoneState = await page.evaluate(() => {
    const zone = document.querySelector(".loc-gap-zone");
    if (!zone) return { exists: false };
    const opts = [...zone.querySelectorAll(".gap-opt")].map((o) => ({
      kind: o.dataset.kind,
      text: o.textContent,
      active: o.classList.contains("active"),
      disabled: o.classList.contains("disabled"),
    }));
    return { exists: true, display: getComputedStyle(zone).display, opts };
  });
  console.log("拖拽中 zone 状态:", JSON.stringify(zoneState));

  await page.mouse.up();
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT_DIR, "Z-after.png") });

  const afterMap = await getStructure(page);
  printStructure(afterMap, "拖拽后结构:");

  // 差异
  const moved = [];
  for (const id in beforeMap) {
    if (beforeMap[id].parentId !== afterMap[id]?.parentId) {
      moved.push(`#${id} ${beforeMap[id].name}: ${beforeMap[id].parentId || "root"} → ${afterMap[id]?.parentId || "root"}`);
    }
  }
  console.log("\n===== 移动的位置 =====");
  moved.forEach((m) => console.log("  " + m));
  if (!moved.length) console.log("(无变化)");

  console.log("\n===== 失败请求 =====");
  badReqs.forEach((r) => console.log("  " + r));
  if (!badReqs.length) console.log("(无失败请求)");

  console.log("\n===== Console 错误 =====");
  logs.forEach((l) => console.log("  " + l));
  if (!logs.length) console.log("(无错误)");

  await browser.close();
  console.log("\n完成。截图:", OUT_DIR);
})().catch((e) => {
  console.error("失败:", e.message, e.stack);
  process.exit(1);
});