import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearSession, markAuthenticated } from "../api";
import { createAccountBundle, unlockAccount } from "../crypto";

type AuthResponse = { user: { id: string; username: string; crypto_salt: string; crypto_public_key: JsonWebKey; wrapped_private_key: { iv: string; ciphertext: string; iterations: number } } };

export default function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ username: "", email: "", password: "", displayName: "", adminBootstrapToken: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (mode === "signup") {
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
      markAuthenticated(); setForm((prev) => ({ ...prev, password: "", adminBootstrapToken: "" })); nav("/");
    } catch (err) {
      clearSession(); setError((err as Error).message || "Unable to unlock encrypted account data");
    } finally { setBusy(false); }
  }

  return (
    <main className="screen auth">
      <h1>ChatApp</h1><p className="muted">End-to-end encrypted chat</p>
      <form onSubmit={submit}>
        {mode === "signup" && <>
          <input placeholder="Username (public handle)" value={form.username} onChange={set("username")} required minLength={3} maxLength={30} />
          <input type="text" placeholder="Display name (encrypted)" value={form.displayName} onChange={set("displayName")} />
          <input type="email" placeholder="Email (encrypted)" value={form.email} onChange={set("email")} required />
          <input type="password" placeholder="One-time admin setup key (admin only)" value={form.adminBootstrapToken} onChange={set("adminBootstrapToken")} autoComplete="off" />
          <small className="muted">Leave blank for a normal account. Only the first valid setup key can create the site administrator.</small>
        </>}
        {mode === "login" && <input placeholder="Username" value={form.username} onChange={set("username")} required />}
        <input type="password" placeholder="Password" value={form.password} onChange={set("password")} required minLength={mode === "signup" ? 12 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {mode === "signup" && <small className="muted">Use at least 12 characters. Your password protects your private encryption key and cannot be recovered.</small>}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Securing account…" : mode === "login" ? "Log in" : "Create encrypted account"}</button>
      </form>
      <button className="link" onClick={() => { setError(""); setMode(mode === "login" ? "signup" : "login"); }}>
        {mode === "login" ? "New here? Create account" : "Have an account? Log in"}
      </button>
    </main>
  );
}
