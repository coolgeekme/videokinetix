import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Generous default timeout — analyze_form (GPT-5.2) takes ~15-25s; mobile
// networks add latency. iOS Safari cancels stalled XHRs aggressively, so we
// pad heavily here. Individual callers can override per-request.
export const api = axios.create({ baseURL: API, timeout: 120000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("kinetic_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("kinetic_token");
      localStorage.removeItem("kinetic_user");
    }
    return Promise.reject(err);
  }
);

/** Extract a human-readable error message from any axios/FastAPI error. */
export function errMsg(err, fallback = "Something went wrong") {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) =>
        typeof d === "string"
          ? d
          : d?.msg
            ? `${(d.loc || []).slice(-1)[0] || "field"}: ${d.msg}`
            : JSON.stringify(d)
      )
      .join(" · ");
  }
  if (detail && typeof detail === "object") {
    return detail.msg || JSON.stringify(detail);
  }
  if (typeof err?.message === "string") return err.message;
  return fallback;
}
