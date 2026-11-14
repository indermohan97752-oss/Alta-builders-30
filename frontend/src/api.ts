import { lockAccount } from "./crypto";
const AUTH_FLAG = "chat_authenticated";
// Route HTTP API requests through the Vercel origin. This keeps the HttpOnly\n// session cookie first-party in browsers that block third-party cookies.\nconst API_ORIGIN = "";

// The real session credential is an HttpOnly cookie. sessionStorage is only a
// navigation hint; the E2EE private key is kept in JS memory, never persisted.
export const isAuthenticated = () => sessionStorage.getItem(AUTH_FLAG) === "1";
export const markAuthenticated = () => sessionStorage.setItem(AUTH_FLAG, "1");
export const clearSession = () => {
  sessionStorage.removeItem(AUTH_FLAG);
  lockAccount();
};

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_ORIGIN) throw new Error("The API URL is not configured. Set VITE_API_URL in the frontend deployment settings.");
  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearSession();
    const detail = data.fields ? (Object.values(data.fields) as string[][]).flat().join(". ") : "";
    throw new Error(detail || (typeof data.error === "string" ? data.error : "Request failed"));
  }
  return data;
}
