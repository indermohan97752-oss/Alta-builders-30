import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { cacheRoomKey, createRoomKey, decryptRoomMetadata, encryptRoomMetadataWithKey, getCurrentUserId, unwrapRoomKey, wrapRoomKeyForUser } from "../crypto";
import { getSocket } from "../socket";
import type { Room } from "../types";

type PublicKeyResponse = { public_key: JsonWebKey };

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<"all" | "direct" | "group">("all");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const records = await api<Room[]>("/rooms");
      const unlocked = await Promise.all(records.map(async (room) => {
        try {
          for (const envelope of room.key_envelopes) await unwrapRoomKey(room.id, envelope.wrapped_key, envelope.key_version);
          const meta = await decryptRoomMetadata(room.id, room.encrypted_metadata, room.current_key_version);
          return { ...room, name: meta.name };
        } catch {
          return { ...room, name: "Locked encrypted room" };
        }
      }));
      setRooms(unlocked);
      setError("");
    } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => {
    void load();
    const socket = getSocket();
    socket.on("message:new", load);
    socket.on("room:updated", load);
    socket.on("room:added", load);
    socket.on("room:removed", load);
    return () => { socket.off("message:new", load); socket.off("room:updated", load); socket.off("room:added", load); socket.off("room:removed", load); };
  }, []);

  async function createGroup() {
    const name = prompt("Group name");
    const userId = getCurrentUserId();
    if (!name?.trim() || !userId) return;
    try {
      const keyResponse = await api<PublicKeyResponse>(`/users/${userId}/crypto-key`);
      const { raw, key } = await createRoomKey();
      const encryptedMetadata = await encryptRoomMetadataWithKey(key, { name: name.trim() });
      const keyEnvelope = { userId, wrappedKey: await wrapRoomKeyForUser(raw, keyResponse.public_key) };
      raw.fill(0);
      const created = await api<{ id: string }>("/rooms", {
        method: "POST",
        body: JSON.stringify({ memberIds: [], encryptedMetadata, keyEnvelopes: [keyEnvelope] }),
      });
      cacheRoomKey(created.id, 1, key);
      await load();
    } catch (err) { setError((err as Error).message); }
  }

  const visible = rooms.filter((r) => filter === "all" || r.type === filter);
  return (
    <main className="screen">
      <header className="bar"><h2>Chats</h2><button onClick={createGroup}>+ Encrypted group</button></header>
      <nav className="tabs">{(["all", "direct", "group"] as const).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>)}</nav>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {visible.map((r) => <li key={r.id}><Link to={`/rooms/${r.id}`}>
          <div className="avatar">{(r.name ?? "E2E").slice(0, 2).toUpperCase()}</div>
          <div className="meta"><strong>{r.name ?? "Encrypted room"}</strong><span className="muted">{r.last_sender ? `${r.last_sender}: ` : ""}{r.last_content ?? "No messages yet"}</span></div>
          {r.unread > 0 && <span className="badge">{r.unread}</span>}
        </Link></li>)}
      </ul>
      <footer className="nav"><Link to="/">Chats</Link><Link to="/profile">Profile</Link></footer>
    </main>
  );
}
