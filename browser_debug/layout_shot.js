const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT_DIR = path.resolve(__dirname, "shots_v6");
(async () => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox"] });
    for (const w of [1280, 430]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 900 });
      await page.goto("http://127.0.0.1:8000/", { waitUntil: "networkidle2", timeout: 30000 });
      const needLogin = await page.evaluate(() => !!document.querySelector("#auth-form"));
      if (needLogin) {
        await page.type("#username", "admin");
        await page.type("#password", "Mm123456.");
        await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}), page.click("#submit-btn")]);
        await new Promise((r) => setTimeout(r, 1200));
      }
      await page.click("#add-item-btn");
      await new Promise((r) => setTimeout(r, 1000));
      await page.screenshot({ path: path.join(OUT_DIR, `add-page-${w}.png`) });
      console.log("shot:", w);
      await page.close();
    }
    await browser.close();
  } catch (e) {
    console.log("ERR:" + e.message);
    process.exit(1);
  }
})();
