import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, clearSession, markAuthenticated } from "../api";
import { createAccountBundle, unlockAccount } from "../crypto";

type AuthResponse = { user: { id: string; username: string; crypto_salt: string; crypto_public_key: JsonWebKey; wrapped_private_key: { iv: string; ciphertext: string; iterations: number } } };

function validateSignupPassword(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters for your password.";
  if (new TextEncoder().encode(password).length > 72) return "Password is too long. Use no more than 72 UTF-8 bytes.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number in your password.";
  }
  return null;
}

export default function AuthPage() {
  const nav = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ username: "", email: "", password: "", displayName: "", adminBootstrapToken: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (mode === "signup") {
        const passwordError = validateSignupPassword(form.password);
        if (passwordError) { setError(passwordError); return; }
        if (!window.isSecureContext || !window.crypto?.subtle) {
          throw new Error("Secure password setup is not available in this browser tab. Open the HTTPS site in a modern browser and try again.");
        }
        const bundle = await createAccountBundle(form.password, {
          email: form.email.trim().toLowerCase(), displayName: form.displayName.trim() || form.username, bio: "", avatarUrl: "",
        });
        const response = await api<{ user: { id: string; username: string } }>("/auth/signup", {
          method: "POST",
          body: JSON.stringify({ username: form.username, password: form.password, ...(form.adminBootstrapToken.trim() ? { adminBootstrapToken: form.adminBootstrapToken.trim() } : {}), ...bundle }),
        });
        await unlockAccount(response.user.id, form.password, { cryptoSalt: bundle.cryptoSalt, cryptoPublicKey: bundle.cryptoPublicKey, wrappedPrivateKey: bundle.wrappedPrivateKey });
      } else {
        const response = await api<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ username: form.username, password: form.password }) });
        await unlockAccount(response.user.id, form.password, { cryptoSalt: response.user.crypto_salt, cryptoPublicKey: response.user.crypto_public_key, wrappedPrivateKey: response.user.wrapped_private_key });
      }
      markAuthenticated(); setForm((prev) => ({ ...prev, password: "", adminBootstrapToken: "" })); const destination = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from; nav(destination?.pathname ? destination.pathname + (destination.search ?? "") + (destination.hash ?? "") : "/");
    } catch (err) {
      clearSession(); setError((err as Error).message || "Unable to unlock encrypted account data");
    } finally { setBusy(false); }
  }

  return (
    <main className="screen auth">
      <h1>ChatApp</h1><p className="muted">End-to-end encrypted chat</p>
      <form onSubmit={submit}>
        {mode === "signup" && <>
          <input placeholder="Username (public handle)" value={form.username} onChange={set("username")} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" title="Use 3-30 letters, numbers or underscores." />
          <input type="text" placeholder="Display name (encrypted)" value={form.displayName} onChange={set("displayName")} />
          <input type="email" placeholder="Email (encrypted)" value={form.email} onChange={set("email")} required />
          <input type="password" placeholder="One-time admin setup key (admin only)" value={form.adminBootstrapToken} onChange={set("adminBootstrapToken")} autoComplete="off" />
          <small className="muted">Leave this blank for a normal account. This is a separate one-time key supplied privately by the site owner — it is not your account password.</small>
        </>}
        {mode === "login" && <input placeholder="Username" value={form.username} onChange={set("username")} required />}
        <input type="password" placeholder="Password" value={form.password} onChange={set("password")} required minLength={mode === "signup" ? 12 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {mode === "signup" && <small className="muted">Use at least 12 characters, including one letter and one number (maximum 72 UTF-8 bytes). Your password protects your private encryption key and cannot be recovered.</small>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Securing account…" : mode === "login" ? "Log in" : "Create encrypted account"}</button>
      </form>
      <button className="link" onClick={() => { setError(""); setMode(mode === "login" ? "signup" : "login"); }}>
        {mode === "login" ? "New here? Create account" : "Have an account? Log in"}
      </button>
    </main>
  );
}
