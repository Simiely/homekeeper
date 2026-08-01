// 验证编辑模式下精确缝隙拖拽能真正放置
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

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await login(page);

  // 进入编辑模式
  await page.evaluate(() => document.querySelector("#loc-edit-toggle").click());
  await sleep(400);

  // 结构（记录厨房当前父级）
  const getParent = () => page.evaluate(() => {
    const c = document.querySelector('.loc-card[data-id="2"]');
    return c.parentElement.classList.contains("loc-children") ? c.parentElement.parentElement.dataset.id : null;
  });
  const beforeParent = await getParent();
  console.log("拖拽前厨房 parent:", beforeParent);

  // 目标：把厨房拖到「储物间(#4)」和「书房(#6)」之间的缝隙（精确）
  // 先获取缝隙位置：书房 head.bottom 与储物间 head.top 的中点
  const gap = await page.evaluate(() => {
    const headOf = (id) => document.querySelector(`.loc-card[data-id="${id}"] .loc-head`).getBoundingClientRect();
    const h4 = headOf(4);
    const h6 = headOf(6);
    return {
      y: (h4.top + h6.bottom) / 2, // 缝隙中点
      x: h4.left + h4.width / 2,
    };
  });
  const from = await page.evaluate(() => {
    const r = document.querySelector('.loc-card[data-id="2"] .loc-head').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  console.log(`缝隙(储物间↔书房): y=${gap.y}, 起点: (${from.x},${from.y})`);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    const t = i / 25;
    await page.mouse.move(from.x + (gap.x - from.x) * t, from.y + (gap.y - from.y) * t);
    await sleep(20);
  }
  await sleep(400);
  const zoneState = await page.evaluate(() => {
    const z = document.querySelector(".loc-gap-zone");
    if (!z) return { exists: false };
    const r = z.getBoundingClientRect();
    return {
      exists: true,
      display: getComputedStyle(z).display,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
      opts: [...z.querySelectorAll(".gap-opt")].map((o) => o.textContent),
      activeKind: [...z.querySelectorAll(".gap-opt")].find((o) => o.classList.contains("active"))?.dataset.kind || null,
    };
  });
  console.log("拖拽中 zone:", JSON.stringify(zoneState));

  // 松手位置 = 缝隙中点（zone 内部）
  await page.mouse.up();
  await sleep(2500);

  const afterParent = await getParent();
  console.log("拖拽后厨房 parent:", afterParent, beforeParent !== afterParent ? "✅ 已移动" : "❌ 未移动");

  await page.evaluate(() => document.querySelector("#loc-edit-toggle").click()); // 退出编辑
  await sleep(300);
  await page.screenshot({ path: path.join(OUT_DIR, "E4-drag-result.png") });
  await browser.close();
  console.log("完成");
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
