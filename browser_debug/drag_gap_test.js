// 验证编辑模式拖拽：先触发拖拽（间距拉开）再扫描缝隙，验证放置
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

async function findGap(page, x) {
  return page.evaluate((px) => {
    const heads = [...document.querySelectorAll("#loc-tree .loc-head")].map((h) => {
      const r = h.getBoundingClientRect();
      return { id: h.closest(".loc-card").dataset.id, top: r.top, bottom: r.bottom, left: r.left, width: r.width };
    });
    heads.sort((a, b) => a.top - b.top);
    for (let i = 0; i < heads.length - 1; i++) {
      const gap = heads[i + 1].top - heads[i].bottom;
      if (gap > 20) {
        const y = (heads[i].bottom + heads[i + 1].top) / 2;
        const el = document.elementFromPoint(px, y);
        if (!el || !el.closest(".loc-card")) {
          return { y, aboveId: heads[i].id, belowId: heads[i + 1].id };
        }
      }
    }
    return null;
  }, x);
}

async function getParent(page, id) {
  return page.evaluate((i) => {
    const c = document.querySelector(`.loc-card[data-id="${i}"]`);
    return c.parentElement.classList.contains("loc-children") ? c.parentElement.parentElement.dataset.id : null;
  }, id);
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

  // 拖「玄关(#5)」
  const from = await page.evaluate(() => {
    const r = document.querySelector('.loc-card[data-id="5"] .loc-head').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const beforeParent = await getParent(page, 5);
  console.log("拖拽前玄关 parent:", beforeParent);

  // 按住并小移动触发拖拽（间距拉开）
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10);
  await sleep(300); // 等间距拉开动画

  // 动态扫描缝隙（此时间距已拉开）
  const gap = await findGap(page, from.x);
  console.log("拖拽中缝隙:", JSON.stringify(gap));

  if (gap) {
    // 移到缝隙（左半 = 同级）
    await page.mouse.move(from.x + (gap.x === undefined ? 0 : 0), gap.y); // 垂直对齐
    // 直接移动到缝隙的 x
    const gapX = from.x; // 保持同 x
    await page.mouse.move(gapX, gap.y - 0); // 缝隙中点略偏上？不，精确缝隙
    await sleep(400);
    const zoneState = await page.evaluate(() => {
      const z = document.querySelector(".loc-gap-zone");
      if (!z) return { exists: false };
      const r = z.getBoundingClientRect();
      return {
        display: getComputedStyle(z).display,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        opts: [...z.querySelectorAll(".gap-opt")].map((o) => ({ text: o.textContent, active: o.classList.contains("active"), disabled: o.classList.contains("disabled") })),
      };
    });
    console.log("zone 状态:", JSON.stringify(zoneState));

    // 松手（位置在 zone 内）
    await page.mouse.up();
    await sleep(2500);
    const afterParent = await getParent(page, 5);
    console.log("拖拽后玄关 parent:", afterParent, beforeParent !== afterParent ? "✅ 已移动" : "❌ 未移动（可能同级排序）");
  } else {
    await page.mouse.up();
    console.log("未找到缝隙");
  }

  await page.screenshot({ path: path.join(OUT_DIR, "E5-drag-after.png") });
  await page.evaluate(() => document.querySelector("#loc-edit-toggle").click());
  await sleep(300);
  await browser.close();
  console.log("完成");
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
