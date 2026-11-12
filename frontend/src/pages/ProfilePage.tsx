import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, clearSession } from "../api";
import { decryptPrivateProfile, fingerprintPublicKey } from "../crypto";
import { closeSocket } from "../socket";
import type { Me } from "../types";

type PrivateProfile = { email?: string; displayName?: string; bio?: string; avatarUrl?: string };

export default function ProfilePage() {
  const nav = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<PrivateProfile>({});
  const [error, setError] = useState("");
  const [fingerprint, setFingerprint] = useState("");

  useEffect(() => {
    let active = true;
    api<Me>("/users/me").then(async (user) => {
      const privateProfile = await decryptPrivateProfile(user.encrypted_profile) as PrivateProfile;
      const publicKeyFingerprint = await fingerprintPublicKey(user.crypto_public_key);
      if (active) { setMe(user); setProfile(privateProfile); setFingerprint(publicKeyFingerprint); }
    }).catch((err) => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, []);

  async function logout() {
    closeSocket();
    try { await api("/auth/logout", { method: "POST" }); }
    finally { clearSession(); nav("/login"); }
  }

  if (error) return <main className="screen"><p className="error">{error}</p><button onClick={logout}>Log out</button></main>;
  if (!me) return <main className="screen"><p className="muted">Unlocking encrypted profile…</p></main>;

  return (
    <main className="screen">
      <header className="bar"><Link to="/">←</Link><h2>Private profile</h2></header>
      <div className="profile">
        <div className="avatar big">{(profile.displayName ?? me.username).slice(0, 2).toUpperCase()}</div>
        <h3>{profile.displayName ?? me.username}</h3>
        <p className="muted">@{me.username} · {me.status}</p>
        {profile.email && <p>{profile.email}</p>}
        {profile.bio && <p>{profile.bio}</p>}
        <small className="muted">Your email, display name and bio are encrypted on the server.</small>
        <section className="key-fingerprint"><b>Identity key fingerprint</b><code>{fingerprint || "Calculating…"}</code><small className="muted">Share this fingerprint through a trusted separate channel so contacts can verify your encryption identity.</small></section>
      </div>
      <div className="stats"><div><b>{me.stats.rooms}</b>Rooms</div><div><b>{me.stats.sent_today}</b>Sent today</div></div>
      <button className="danger" onClick={logout}>Log out and lock encryption keys</button>
    </main>
  );
}
