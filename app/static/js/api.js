// API 封装：自动携带 JWT、统一错误处理、401 跳登录
export const API = "/api";

export function getToken() {
  return localStorage.getItem("hk_token");
}

export function logout() {
  localStorage.removeItem("hk_token");
  location.href = "/login.html";
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
};
