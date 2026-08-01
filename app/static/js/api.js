// API 封装：自动携带 JWT、统一错误处理、401 跳登录
export const API = "/api";

export function getToken() {
  return localStorage.getItem("hk_token");
}

export function logout() {
  localStorage.removeItem("hk_token");
  location.href = "/login.html";
}

// 生成带 token 的资源 URL：<img>/<a> 无法携带 header，只能走 ?token= query
export function imgUrl(path) {
  const token = getToken();
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${path}${sep}token=${encodeURIComponent(token)}` : path;
}

async function request(method, path, body, isFormData) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // multipart/form-data：不设 Content-Type，让浏览器自动加 boundary
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    logout();
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `请求失败 (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b),
  put: (p, b) => request("PUT", p, b),
  del: (p) => request("DELETE", p),
  upload: (p, fd) => request("POST", p, fd, true),
  // 带鉴权下载（window.open 无法携带 Bearer header，必须走 fetch+blob）
  download: async (p) => {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API}${p}`, { headers });
    if (res.status === 401) {
      logout();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `下载失败 (${res.status})`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const filename = m ? decodeURIComponent(m[1]) : `export_${Date.now()}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
