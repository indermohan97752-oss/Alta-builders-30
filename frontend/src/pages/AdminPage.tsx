import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

type Overview = { users: number; rooms: number; messages: number; admins: number };

export default function AdminPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const me = await api<{ role: string }>("/users/me");
        if (me.role !== "admin") { navigate("/", { replace: true }); return; }
        const data = await api<Overview>("/admin/overview");
        if (active) setOverview(data);
      } catch (err) { if (active) setError((err as Error).message || "Unable to load administrator overview"); }
    })();
    return () => { active = false; };
  }, [navigate]);
  return (
    <main className="screen">
      <header className="bar"><h2>Administrator</h2><Link to="/">Back to chats</Link></header>
      <section className="profile"><div className="avatar big">AD</div><h2>Admin overview</h2><p className="muted">Private site administration</p></section>
      {error && <p className="error">{error}</p>}
      {overview && <section className="admin-stats">
        <div><strong>{overview.users}</strong><span>Registered users</span></div>
        <div><strong>{overview.rooms}</strong><span>Chat rooms</span></div>
        <div><strong>{overview.messages}</strong><span>Stored messages</span></div>
        <div><strong>{overview.admins}</strong><span>Administrators</span></div>
      </section>}
      <footer className="nav"><Link to="/">Chats</Link><Link to="/profile">Profile</Link></footer>
    </main>
  );
}
