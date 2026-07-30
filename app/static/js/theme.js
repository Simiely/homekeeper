// 主题切换：默认深色，可切换浅色，记忆到 localStorage
const THEME_KEY = "hk_theme";
const DEFAULT_THEME = "dark";

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  updateToggleButton(theme);
}

export function toggleTheme() {
  const cur = getTheme();
  setTheme(cur === "dark" ? "light" : "dark");
}

function updateToggleButton(theme) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.textContent = theme === "dark" ? "🌙" : "☀️";
  btn.title = theme === "dark" ? "切换到浅色模式" : "切换到深色模式";
}

// 初始化：应用主题 + 绑定按钮
export function initThemeToggle() {
  const theme = getTheme();
  document.documentElement.setAttribute("data-theme", theme);
  updateToggleButton(theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.onclick = toggleTheme;
}

// 立即执行（适用于 module）
initThemeToggle();