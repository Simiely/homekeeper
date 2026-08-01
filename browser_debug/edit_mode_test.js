// 验证「编辑模式 + 点击改名」新交互
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
  const logs = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message.slice(0, 200)}`));

  await login(page);
  await page.screenshot({ path: path.join(OUT_DIR, "E1-locations.png") });

  // 1. 工具栏：编辑按钮存在且文案为「✎ 编辑」
  const btnText = await page.evaluate(() => document.querySelector("#loc-edit-toggle")?.textContent || "NOT FOUND");
  console.log("1. 编辑按钮文案:", btnText);

  // 2. 默认模式：点击「厨房」卡片 → 出现改名表单
  await page.evaluate(() => {
    document.querySelector('.loc-card[data-id="2"] .loc-head')?.click();
  });
  await sleep(400);
  const renameShown = await page.evaluate(() => {
    const form = document.querySelector('.loc-card[data-id="2"] .loc-inline-form form');
    return form ? { exists: true, inputValue: form.querySelector("[name=name]")?.value } : { exists: false };
  });
  console.log("2. 点击厨房 → 改名表单:", JSON.stringify(renameShown));
  await page.screenshot({ path: path.join(OUT_DIR, "E2-rename.png") });

  // 3. 修改名称并保存
  if (renameShown.exists) {
    const saveResult = await page.evaluate(async () => {
      const form = document.querySelector('.loc-card[data-id="2"] .loc-inline-form form');
      const input = form.querySelector("[name=name]");
      input.value = "厨房-改名测试";
      await new Promise((r) => setTimeout(r, 200));
      form.requestSubmit();
      await new Promise((r) => setTimeout(r, 1500));
      const name = document.querySelector('.loc-card[data-id="2"] .loc-name')?.textContent;
      return { saved: name === "厨房-改名测试", now: name };
    });
    console.log("3. 改名结果:", JSON.stringify(saveResult));
  }

  // 4. 恢复原名
  await page.evaluate(async () => {
    const head = document.querySelector('.loc-card[data-id="2"] .loc-head');
    head.click();
    await new Promise((r) => setTimeout(r, 400));
    const form = document.querySelector('.loc-card[data-id="2"] .loc-inline-form form');
    if (form) {
      form.querySelector("[name=name]").value = "厨房";
      form.requestSubmit();
      await new Promise((r) => setTimeout(r, 1500));
    }
  });
  const restored = await page.evaluate(() => document.querySelector('.loc-card[data-id="2"] .loc-name')?.textContent);
  console.log("4. 恢复原名:", restored);

  // 5. 点击「编辑」→ 进入编辑模式（按钮变完成，body 有 class）
  await page.evaluate(() => document.querySelector("#loc-edit-toggle").click());
  await sleep(400);
  const editState = await page.evaluate(() => ({
    btn: document.querySelector("#loc-edit-toggle")?.textContent,
    bodyClass: document.body.classList.contains("loc-edit-mode"),
    status: document.getElementById("loc-status")?.textContent || "",
  }));
  console.log("5. 编辑模式:", JSON.stringify(editState));
  await page.screenshot({ path: path.join(OUT_DIR, "E3-edit-mode.png") });

  // 6. 编辑模式下点击卡片 → 不应弹改名（拖拽模式）
  await page.evaluate(() => document.querySelector('.loc-card[data-id="2"] .loc-head')?.click());
  await sleep(300);
  const renameInEdit = await page.evaluate(() => !!document.querySelector('.loc-card[data-id="2"] .loc-inline-form'));
  console.log("6. 编辑模式点击卡片 → 弹改名?", renameInEdit, "(应为 false)");

  // 7. 编辑模式下真实拖拽：厨房(#2) → 拖到储物间(#4) 之后（同级）
  const from = await page.evaluate(() => {
    const r = document.querySelector('.loc-card[data-id="2"] .loc-head').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const to = await page.evaluate(() => {
    const r = document.querySelector('.loc-card[data-id="4"] .loc-head').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top - 12 }; // 储物间上方缝隙
  });
  console.log(`7. 拖拽: (${from.x},${from.y}) → (${to.x},${to.y})`);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await sleep(20);
  }
  await sleep(400);
  const zoneState = await page.evaluate(() => {
    const z = document.querySelector(".loc-gap-zone");
    if (!z) return { exists: false };
    return {
      exists: true,
      display: getComputedStyle(z).display,
      opts: [...z.querySelectorAll(".gap-opt")].map((o) => o.textContent),
    };
  });
  console.log("拖拽中 zone:", JSON.stringify(zoneState));
  await page.mouse.up();
  await sleep(2000);

  // 8. 结构对比：厨房是否移动
  const structure = await page.evaluate(() => {
    const map = {};
    document.querySelectorAll("#loc-tree .loc-card").forEach((c) => {
      map[c.dataset.id] = {
        name: c.querySelector(".loc-name")?.textContent,
        parentId: c.parentElement.classList.contains("loc-children") ? c.parentElement.parentElement.dataset.id : null,
      };
    });
    return map;
  });
  console.log("8. 拖拽后厨房 parent:", structure["2"]?.parentId, "(应为 4 或 null)");

  // 9. 点「完成」退出编辑模式
  await page.evaluate(() => document.querySelector("#loc-edit-toggle").click());
  await sleep(300);
  const exitState = await page.evaluate(() => ({
    btn: document.querySelector("#loc-edit-toggle")?.textContent,
    bodyClass: document.body.classList.contains("loc-edit-mode"),
  }));
  console.log("9. 退出编辑:", JSON.stringify(exitState));

  console.log("\n===== Console 错误 =====");
  logs.forEach((l) => console.log("  " + l));
  if (!logs.length) console.log("(无错误)");

  await browser.close();
  console.log("完成。截图:", OUT_DIR);
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
