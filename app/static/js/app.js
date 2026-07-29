// 导航调度：视图切换、鉴权检查
import { getToken, logout } from "./api.js";
import { renderItems } from "./items.js";
import { renderLocations } from "./locations.js";
import { renderCategories } from "./categories.js";
import { renderDashboard } from "./dashboard.js";

if (!getToken()) location.href = "/login.html";

document.getElementById("logout").onclick = logout;

const views = {
  dashboard: renderDashboard,
  items: renderItems,
  locations: renderLocations,
  categories: renderCategories,
};

document.querySelectorAll("nav button[data-view]").forEach((btn) => {
  btn.onclick = () => {
    document
      .querySelectorAll("nav button")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.add("hidden"));
    const name = btn.dataset.view;
    document.getElementById(`view-${name}`).classList.remove("hidden");
    views[name]();
  };
});

views.dashboard();
