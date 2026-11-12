import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { decryptRoomMetadata, decryptRoomText, encryptRoomText, unwrapRoomKey } from "../crypto";
import { getSocket } from "../socket";
import type { Message, RoomDetails } from "../types";

async function decryptMessage(roomId: string, message: Message): Promise<Message> {
  if (message.type === "system") return { ...message, display_content: message.content ?? "System notice" };
  if (!message.encrypted_content || !message.encrypted_iv || !message.encryption_version) {
    return { ...message, display_content: "Encrypted message unavailable" };
  }
  try {
    const text = await decryptRoomText(roomId, {
      iv: message.encrypted_iv,
      ciphertext: message.encrypted_content,
    }, message.encryption_version);
    return { ...message, display_content: text };
  } catch {
    return { ...message, display_content: "This message is encrypted with a key unavailable on this device" };
  }
}

export default function ChatRoomPage() {
  const { roomId = "" } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [roomName, setRoomName] = useState("Encrypted room");
  const [keyVersion, setKeyVersion] = useState(1);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const socket = getSocket();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const room = await api<RoomDetails>(`/rooms/${roomId}`);
        for (const envelope of room.key_envelopes) {
          await unwrapRoomKey(roomId, envelope.wrapped_key, envelope.key_version);
        }
        const currentEnvelope = room.key_envelopes.find((item) => item.key_version === room.current_key_version);
        if (!currentEnvelope) throw new Error("Your device does not have the current room encryption key.");
        const metadata = await decryptRoomMetadata(roomId, room.encrypted_metadata, room.current_key_version);
        const encryptedMessages = await api<Message[]>(`/rooms/${roomId}/messages`);
        const readable = await Promise.all(encryptedMessages.map((message) => decryptMessage(roomId, message)));
        if (active) {
          setRoomName(metadata.name);
          setKeyVersion(room.current_key_version);
          setMessages(readable);
          setError("");
        }
      } catch (err) { if (active) setError((err as Error).message); }
    }
    void load();

    const onNew = (message: Message) => {
      if (message.room_id !== roomId) return;
      void decryptMessage(roomId, message).then((readable) => {
        setMessages((prev) => [...prev.filter((m) => m.id !== readable.id), readable]);
        socket.emit("room:read", { roomId, messageId: readable.id });
      }).catch(() => setError("Could not decrypt incoming message. Reload the room to refresh its keys."));
    };
    const onTyping = (event: { roomId: string; isTyping: boolean }) => event.roomId === roomId && setTyping(event.isTyping);
    const onRoomUpdated = (event: { roomId: string }) => { if (event.roomId === roomId) void load(); };
    const onAppError = (event: { error?: string }) => setError(event.error ?? "Realtime action failed");
    socket.on("message:new", onNew);
    socket.on("typing", onTyping);
    socket.on("room:updated", onRoomUpdated);
    socket.on("app:error", onAppError);
    return () => {
      active = false;
      socket.off("message:new", onNew);
      socket.off("typing", onTyping);
      socket.off("room:updated", onRoomUpdated);
      socket.off("app:error", onAppError);
    };
  }, [roomId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
    const last = messages[messages.length - 1];
    if (last) socket.emit("room:read", { roomId, messageId: last.id });
  }, [messages.length]);

  async function loadOlder() {
    if (!messages.length) return;
    try {
      const older = await api<Message[]>(`/rooms/${roomId}/messages?before=${messages[0].id}`);
      const readable = await Promise.all(older.map((message) => decryptMessage(roomId, message)));
      setMessages((prev) => [...readable, ...prev]);
    } catch (err) { setError((err as Error).message); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const clear = text.trim();
    if (!clear) return;
    try {
      const encrypted = await encryptRoomText(roomId, clear, keyVersion);
      socket.emit("message:send", {
        roomId,
        encryptedContent: encrypted.ciphertext,
        encryptedIv: encrypted.iv,
        keyVersion,
      });
      socket.emit("typing", { roomId, isTyping: false });
      setText("");
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <main className="screen chat">
      <header className="bar"><Link to="/">←</Link><div><strong>{roomName}</strong>{typing && <span className="muted"> · typing…</span>}<small className="muted"> · end-to-end encrypted</small></div></header>
      {error && <p className="error">{error}</p>}
      <section className="messages">
        <button className="link" onClick={loadOlder}>Load older messages</button>
        {messages.map((m) => <div key={m.id} className="bubble"><small className="muted">{m.sender_name}</small><p>{m.display_content ?? "Encrypted message"}</p></div>)}
        <div ref={bottom} />
      </section>
      <form className="composer" onSubmit={send}>
        <input value={text} placeholder="Encrypted message" maxLength={8000} onChange={(e) => { setText(e.target.value); socket.emit("typing", { roomId, isTyping: true }); }} />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}
