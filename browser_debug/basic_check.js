// 基础连通性验证 v2：正确处理登录导航
const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const APP_URL = "http://127.0.0.1:8000/";
const OUT_DIR = path.resolve(__dirname, "shots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  page.on("console", (msg) => {
    const t = msg.type();
    if (["error", "warning", "log", "info"].includes(t)) {
      logs.push(`[console.${t}] ${msg.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message.slice(0, 300)}`));
  page.on("requestfailed", (req) =>
    logs.push(`[requestfailed] ${req.url().slice(0, 150)} ${req.failure()?.errorText || ""}`)
  );

  // 1. 打开（未登录 → 重定向 login.html）
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(600);
  console.log("== 初始 URL:", page.url());
  await page.screenshot({ path: path.join(OUT_DIR, "01-login.png") });

  // 2. 登录（用 page.type 填表 + 点击提交，交给 puppeteer 处理导航）
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  await page.type("#username", "admin");
  await page.type("#password", "Mm123456.");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
    page.click("#submit-btn"),
  ]);
  await sleep(1200);
  console.log("== 登录后 URL:", page.url());
  await page.screenshot({ path: path.join(OUT_DIR, "02-after-login.png") });

  // 3. 若还在 login 页（登录失败），输出页面文本排查
  if (page.url().includes("login")) {
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log("== 仍在登录页，页面文本:", bodyText);
  }

  // 4. 切到位置页
  await page.waitForSelector('[data-view="locations"]', { timeout: 10000 }).catch(() => {});
  const navState = await page.evaluate(async () => {
    const btn = document.querySelector('[data-view="locations"]');
    if (!btn) return "no-nav-btn; url=" + location.pathname;
    btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    return "clicked; url=" + location.pathname;
  });
  console.log("== 位置页:", navState);
  await page.screenshot({ path: path.join(OUT_DIR, "03-locations.png") });

  // 5. 位置树结构概要
  const treeInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#loc-tree .loc-card")];
    return {
      cardCount: cards.length,
      firstCard: cards[0]?.dataset.id || null,
      rootChildren: document.querySelector("#loc-tree > .loc-list")?.children.length || 0,
      sample: cards.slice(0, 6).map((c) => `${c.dataset.id}:${c.querySelector(".loc-name")?.textContent}`),
    };
  });
  console.log("== 位置树:", JSON.stringify(treeInfo));

  // 6. 点击「家」展开物品列表
  const expandInfo = await page.evaluate(async () => {
    const head = document.querySelector('.loc-card[data-id="1"] .loc-head');
    if (!head) return "no-head";
    head.click();
    await new Promise((r) => setTimeout(r, 800));
    const items = document.querySelector('.loc-card[data-id="1"] .loc-items');
    return items ? `expanded, items=${items.children.length}` : "no-items-el";
  });
  console.log("== 展开家物品:", expandInfo);
  await page.screenshot({ path: path.join(OUT_DIR, "04-expand-home.png") });

  // 7. 日志输出
  console.log("\n===== CONSOLE / 错误日志 =====");
  logs.forEach((l) => console.log(l));
  if (!logs.length) console.log("(无错误日志)");

  await browser.close();
  console.log("\n完成。截图目录:", OUT_DIR);
})().catch((e) => {
  console.error("脚本失败:", e.message);
  process.exit(1);
});
