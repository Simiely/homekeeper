// v0.9.12 验证：添加页分组顺序 / 必填（名称·位置·照片）/ 间距收紧 / 编辑模式照片预览
const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const APP_URL = "http://127.0.0.1:8000/";
const OUT_DIR = path.resolve(__dirname, "shots_v5");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1x1 红色 PNG
const PNG_BUF = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const testImg = path.join(OUT_DIR, "test-photo.png");
  fs.writeFileSync(testImg, PNG_BUF);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const logs = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) logs.push(`[console.${msg.type()}] ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message.slice(0, 200)}`));
  page.on("response", (res) => {
    const s = res.status();
    if (s >= 400 && !res.url().includes("login.html") && !res.url().includes("favicon")) {
      logs.push(`[http ${s}] ${res.request().method()} ${res.url().slice(0, 100)}`);
    }
  });

  const step = async (name, fn) => {
    try {
      await fn();
      console.log("OK -", name);
    } catch (e) {
      console.log("FAIL -", name, "=>", e.message.slice(0, 200));
      logs.push(`[step-fail] ${name}: ${e.message.slice(0, 200)}`);
    }
  };

  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  await page.type("#username", "admin");
  await page.type("#password", "Mm123456.");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}), page.click("#submit-btn")]);
  await sleep(1200);

  // 1. 分组顺序 + 更多信息内部顺序
  await step("分组顺序正确", async () => {
    await page.click("#add-item-btn");
    await sleep(900);
    const groups = await page.evaluate(() => [...document.querySelectorAll("#view-add .form-group legend")].map((l) => l.textContent.trim()));
    console.log("   分组:", groups.join(" | "));
    const expect = ["条码", "基本信息", "照片*", "保质期", "数量与状态", "更多信息"];
    if (groups.length !== 6) throw new Error("分组数≠6");
    groups.forEach((g, i) => {
      if (!g.includes(expect[i].replace("*", ""))) throw new Error(`分组顺序错: 第${i + 1}组=${g} 期望≈${expect[i]}`);
    });
    // 更多信息内部顺序
    const moreOrder = await page.evaluate(() => {
      const fs2 = [...document.querySelectorAll("#view-add .form-group")];
      const more = fs2[fs2.length - 1];
      return [...more.querySelectorAll(".form-field label")].map((l) => l.textContent.trim());
    });
    console.log("   更多信息:", moreOrder.join(" / "));
    if (JSON.stringify(moreOrder) !== JSON.stringify(["标签", "价格（元）", "保修到期", "序列号"])) throw new Error("更多信息字段顺序错");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "01-add-page-order.png") });

  // 2. 位置必填（required 属性 + 占位文案）
  await step("位置必填", async () => {
    const info = await page.evaluate(() => {
      const sel = document.querySelector("#view-add [name=location_id]");
      return { required: sel.required, placeholder: sel.options[0].textContent };
    });
    console.log("   位置select:", JSON.stringify(info));
    if (!info.required) throw new Error("位置 select 无 required");
  });

  // 3. 提交拦截：没照片/没位置 → 弹提示不提交
  await step("必填拦截", async () => {
    await page.type("#view-add [name=name]", "必填拦截验证");
    await page.evaluate(() => document.querySelector("#view-add #item-form button[type=submit]").click());
    await sleep(600);
    const blocked1 = await page.evaluate(() => !!document.querySelector(".hk-dialog"));
    const msg1 = await page.evaluate(() => document.querySelector(".hk-dialog-msg")?.textContent || "");
    console.log("   无位置/无照片:", msg1.slice(0, 30));
    if (!blocked1 || !msg1.includes("位置")) throw new Error("未拦截（位置）");
    await page.evaluate(() => document.querySelector(".hk-dialog-actions button").click());
    await sleep(300);
    // 选位置但仍无照片
    await page.select("#view-add [name=location_id]", "1");
    await page.evaluate(() => document.querySelector("#view-add #item-form button[type=submit]").click());
    await sleep(600);
    const blocked2 = await page.evaluate(() => document.querySelector(".hk-dialog-msg")?.textContent || "");
    console.log("   无照片:", blocked2.slice(0, 30));
    if (!blocked2.includes("照片")) throw new Error("未拦截（照片）");
    await page.evaluate(() => document.querySelector(".hk-dialog-actions button").click());
    await sleep(300);
  });

  // 4. 上传照片 + 完整填写 → 保存成功
  const itemName = "照片必填验证" + Date.now().toString().slice(-5);
  await step("带照片保存", async () => {
    const input = await page.$("#view-add #item-photo-gallery");
    await input.uploadFile(testImg);
    await sleep(400);
    const hasPreview = await page.evaluate(() => !document.querySelector("#item-photo-preview").classList.contains("hidden"));
    if (!hasPreview) throw new Error("照片未预览");
    await page.evaluate((nm) => {
      const f = document.querySelector("#view-add #item-form");
      f.querySelector("[name=name]").value = nm;
      f.querySelector("button[type=submit]").click();
    }, itemName);
    await sleep(1600);
    const st = await page.evaluate(() => ({
      sel: window.__viewParams?.get("sel") || null,
      detailName: document.querySelector("#item-detail .detail-name")?.textContent || null,
      hasPhoto: !!document.querySelector("#item-detail .detail-photo img"),
    }));
    console.log("   保存后:", JSON.stringify(st));
    if (!st.sel || st.detailName !== itemName) throw new Error("保存失败");
    if (!st.hasPhoto) throw new Error("详情无照片");
  });

  // 5. 编辑该物品 → 照片区显示当前照片预览
  await step("编辑模式照片预览", async () => {
    await page.evaluate(() => document.querySelector('#item-detail [data-act="edit"]').click());
    await sleep(900);
    const st = await page.evaluate(() => ({
      photoVisible: !document.querySelector("#view-add #item-photo-preview").classList.contains("hidden"),
      photoSrc: document.querySelector("#view-add #item-photo-preview").getAttribute("src")?.slice(0, 60) || "",
      locFilled: !!document.querySelector("#view-add [name=location_id]").value,
    }));
    console.log("   编辑照片区:", JSON.stringify(st));
    if (!st.photoVisible || !st.photoSrc.includes("/api/images/")) throw new Error("编辑模式未显示当前照片");
    if (!st.locFilled) throw new Error("位置未回填");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "02-edit-photo.png") });

  // 6. 取消返回，清理测试数据
  await page.evaluate(() => document.querySelector("#view-add #add-cancel").click());
  await sleep(800);
  await step("清理测试数据", async () => {
    const r = await page.evaluate(async (prefix) => {
      const token = localStorage.getItem("hk_token");
      const h = { Authorization: "Bearer " + token };
      const items = (await (await fetch("/api/items?keyword=" + encodeURIComponent(prefix) + "&page_size=50", { headers: h })).json()).items || [];
      let n = 0;
      for (const it of items) {
        if (it.name && it.name.startsWith(prefix)) {
          const imgs = await (await fetch(`/api/items/${it.id}/images`, { headers: h })).json().catch(() => []);
          for (const im of imgs) await fetch(`/api/images/${im.item_id}/${im.filename}`, { method: "DELETE", headers: h });
          await fetch("/api/items/" + it.id, { method: "DELETE", headers: h });
          n++;
        }
      }
      return n;
    }, "照片必填验证");
    console.log("   已清理物品:", r);
  });

  console.log("\n===== CONSOLE / 错误日志 =====");
  logs.forEach((l) => console.log(l));
  if (!logs.length) console.log("(无错误日志)");
  await browser.close();
  console.log("\n完成。截图:", OUT_DIR);
})().catch((e) => {
  console.error("脚本失败:", e.message);
  process.exit(1);
});
