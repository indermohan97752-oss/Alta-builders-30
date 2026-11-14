import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { cacheRoomKey, createInvitationToken, createRoomKey, decryptRoomMetadata, decryptRoomText, encryptInvitationLabel, encryptRoomMetadataWithKey, encryptRoomText, unwrapRoomKey, wrapRoomKeyForUser } from "../crypto";
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

type PublicKeyResponse = { public_key: JsonWebKey };
type UserLite = { id: string; username: string; status: "online" | "away" | "offline" };

export default function ChatRoomPage() {
  const { roomId = "" } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [roomName, setRoomName] = useState("Encrypted room");
  const [keyVersion, setKeyVersion] = useState(1);
  const [room, setRoom] = useState<RoomDetails | null>(null);
  const [error, setError] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserLite[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMode, setInviteMode] = useState<"approval" | "instant">("approval");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [pendingRequests, setPendingRequests] = useState<Array<{ user_id: string; username: string; status: string }>>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const socket = getSocket();

  async function loadRoom() {
    try {
      const details = await api<RoomDetails>(`/rooms/${roomId}`);
      for (const envelope of details.key_envelopes) {
        await unwrapRoomKey(roomId, envelope.wrapped_key, envelope.key_version);
      }
      const currentEnvelope = details.key_envelopes.find((item) => item.key_version === details.current_key_version);
      if (!currentEnvelope) throw new Error("Your device does not have the current room encryption key.");
      const metadata = await decryptRoomMetadata(roomId, details.encrypted_metadata, details.current_key_version);
      const encryptedMessages = await api<Message[]>(`/rooms/${roomId}/messages`);
      const readable = await Promise.all(encryptedMessages.map((message) => decryptMessage(roomId, message)));
      setRoom(details);
      setRoomName(metadata.name);
      setKeyVersion(details.current_key_version);
      setMessages(readable);
      setError("");
    } catch (err) { setError((err as Error).message); }
  }

  useEffect(() => {
    void loadRoom();
    const onNew = (message: Message) => {
      if (message.room_id !== roomId) return;
      void decryptMessage(roomId, message).then((readable) => {
        setMessages((prev) => [...prev.filter((m) => m.id !== readable.id), readable]);
        socket.emit("room:read", { roomId, messageId: readable.id });
      }).catch(() => setError("Could not decrypt incoming message. Reload the room to refresh its keys."));
    };
    const onTyping = (event: { roomId: string; isTyping: boolean }) => event.roomId === roomId && setTyping(event.isTyping);
    const onRoomUpdated = (event: { roomId: string }) => { if (event.roomId === roomId) void loadRoom(); };
    const onAppError = (event: { error?: string }) => setError(event.error ?? "Realtime action failed");
    socket.on("message:new", onNew);
    socket.on("typing", onTyping);
    socket.on("room:updated", onRoomUpdated);
    socket.on("app:error", onAppError);
    return () => {
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

  useEffect(() => {
    const query = memberSearch.trim();
    if (!addOpen || query.length < 2) { setSearchResults([]); setSearching(false); return; }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api<UserLite[]>(`/users?q=${encodeURIComponent(query)}`)
        .then((users) => {
          if (active) {
            const current = new Set(room?.members.map((member) => member.user_id) ?? []);
            setSearchResults(users.filter((user) => !current.has(user.id)));
          }
        })
        .catch((err) => { if (active) setError((err as Error).message); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [memberSearch, addOpen, room]);

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

  async function addSelectedMembers() {
    if (!room || !selectedIds.length || savingMembers) return;
    setSavingMembers(true);
    setError("");
    try {
      // Rotate to a fresh room key. It is wrapped to every current and new
      // member, so new members cannot decrypt messages sent before they joined.
      const resultingIds = [...room.members.map((member) => member.user_id), ...selectedIds];
      const publicKeys = await Promise.all(resultingIds.map(async (userId) => ({
        userId,
        publicKey: (await api<PublicKeyResponse>(`/users/${userId}/crypto-key`)).public_key,
      })));
      const { raw, key } = await createRoomKey();
      const encryptedMetadata = await encryptRoomMetadataWithKey(key, { name: roomName });
      const keyEnvelopes = await Promise.all(publicKeys.map(async (entry) => ({
        userId: entry.userId,
        wrappedKey: await wrapRoomKeyForUser(raw, entry.publicKey),
      })));
      raw.fill(0);
      const nextVersion = room.current_key_version + 1;
      await api(`/rooms/${roomId}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds: selectedIds, encryptedMetadata, keyEnvelopes }),
      });
      cacheRoomKey(roomId, nextVersion, key);
      setKeyVersion(nextVersion);
      setAddOpen(false);
      setInfoOpen(true);
      setSelectedIds([]);
      setMemberSearch("");
      await loadRoom();
    } catch (err) { setError((err as Error).message); }
    finally { setSavingMembers(false); }
  }

  const canManageMembers = room?.type === "group" && (room.my_role === "owner" || room.my_role === "admin");

  async function createInvitation() {
    if (!room || !canManageMembers || inviteBusy) return;
    setInviteBusy(true); setError("");
    try {
      const token = createInvitationToken();
      const encryptedLabel = await encryptInvitationLabel(token, roomName);
      const result = await api<{ token: string; invitationId: string }>("/invitations/rooms/" + roomId + "/invitations", {
        method: "POST", body: JSON.stringify({ mode: inviteMode, token, displayName: encryptedLabel }),
      });
      setInviteUrl(window.location.origin + "/invite/" + result.token);
      setInviteId(result.invitationId);
    } catch (err) { setError((err as Error).message); }
    finally { setInviteBusy(false); }
  }

  async function revokeInvitation() {
    if (!inviteId || inviteBusy) return;
    setInviteBusy(true);
    try { await api("/invitations/rooms/" + roomId + "/invitations/" + inviteId, { method: "DELETE" }); setInviteUrl(""); setInviteId(""); }
    catch (err) { setError((err as Error).message); }
    finally { setInviteBusy(false); }
  }

  async function loadJoinRequests() {
    if (!canManageMembers) return;
    try { setPendingRequests(await api("/invitations/rooms/" + roomId + "/requests")); }
    catch (err) { setError((err as Error).message); }
  }

  async function approveJoinRequest(userId: string) {
    if (!room || !canManageMembers || inviteBusy) return;
    setInviteBusy(true); setError("");
    try {
      const recipientIds = [...new Set([...room.members.map((member) => member.user_id), userId])];
      const publicKeys = await Promise.all(recipientIds.map(async (id) => ({
        userId: id, publicKey: (await api<PublicKeyResponse>("/users/" + id + "/crypto-key")).public_key,
      })));
      const { raw, key } = await createRoomKey();
      try {
        const encryptedMetadata = await encryptRoomMetadataWithKey(key, { name: roomName });
        const keyEnvelopes = await Promise.all(publicKeys.map(async (entry) => ({ userId: entry.userId, wrappedKey: await wrapRoomKeyForUser(raw, entry.publicKey) })));
        const nextVersion = room.current_key_version + 1;
        await api("/invitations/rooms/" + roomId + "/requests/" + userId + "/approve", {
          method: "POST", body: JSON.stringify({ encryptedMetadata, keyEnvelopes }),
        });
        cacheRoomKey(roomId, nextVersion, key);
        setKeyVersion(nextVersion);
        await loadRoom();
        await loadJoinRequests();
      } finally { raw.fill(0); }
    } catch (err) { setError((err as Error).message); }
    finally { setInviteBusy(false); }
  }

  useEffect(() => { if (infoOpen && canManageMembers) void loadJoinRequests(); }, [infoOpen, canManageMembers, roomId]);


  return (
    <main className="screen chat">
      <header className="bar chat-room-bar">
        <Link to="/">←</Link>
        <div className="chat-room-heading">
          <strong>{roomName}</strong>
          {typing && <span className="muted"> · typing…</span>}
          <small className="muted"> · end-to-end encrypted</small>
        </div>
        {room?.type === "group" && <button type="button" className="group-info-trigger" onClick={() => setInfoOpen(true)}>Group info</button>}
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="messages">
        <button className="link" onClick={loadOlder}>Load older messages</button>
        {messages.map((m) => <div key={m.id} className="bubble"><small className="muted">{m.sender_name}</small><p>{m.display_content ?? "Encrypted message"}</p></div>)}
        <div ref={bottom} />
      </section>
      <form className="composer" onSubmit={send}>
        <input value={text} placeholder="Encrypted message" maxLength={8000} onChange={(e) => { setText(e.target.value); socket.emit("typing", { roomId, isTyping: true }); }} />
        <button type="submit">Send</button>
      </form>

      {infoOpen && room?.type === "group" && (
        <div className="group-info-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setInfoOpen(false); }}>
          <section className="group-info-card" role="dialog" aria-modal="true" aria-labelledby="group-info-title">
            <div className="group-info-heading">
              <div><p className="eyebrow">GROUP DETAILS</p><h2 id="group-info-title">{roomName}</h2><p className="muted">{room.members.length} members · encrypted group</p></div>
              <button type="button" className="close-button" aria-label="Close group info" onClick={() => setInfoOpen(false)}>×</button>
            </div>
            {canManageMembers && <div className="group-admin-actions"><button type="button" className="full-button" onClick={() => { setInfoOpen(false); setAddOpen(true); }}>＋ Add members</button><button type="button" className="full-button" onClick={() => { setInviteOpen(true); setInviteUrl(""); }}>Invite with link</button></div>}

            {canManageMembers && pendingRequests.length > 0 && <section className="group-join-requests"><h3 className="group-members-title">Join requests ({pendingRequests.length})</h3>{pendingRequests.map((request) => <div className="group-member-row" key={request.user_id}><span className="avatar">{request.username.slice(0, 2).toUpperCase()}</span><span className="group-member-copy"><strong>{request.username}</strong><small>{request.status}</small></span><button type="button" className="text-action" disabled={inviteBusy} onClick={() => void approveJoinRequest(request.user_id)}>Approve</button></div>)}</section>}
            <h3 className="group-members-title">Members</h3>
            <div className="group-members-list">
              {room.members.map((member) => (
                <div className="group-member-row" key={member.user_id}>
                  <span className="avatar">{member.username.slice(0, 2).toUpperCase()}</span>
                  <span className="group-member-copy"><strong>{member.username}</strong><small>{member.status}</small></span>
                  <span className="member-role">{member.role}</span>
                </div>
              ))}
            </div>
            <p className="security-note">New members receive the current encryption key only. They cannot read messages sent before they joined.</p>
          </section>
        </div>
      )}


      {inviteOpen && (
        <div className="group-info-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !inviteBusy) setInviteOpen(false); }}>
          <section className="group-info-card" role="dialog" aria-modal="true" aria-labelledby="invite-group-title">
            <div className="group-info-heading"><div><p className="eyebrow">GROUP INVITATION</p><h2 id="invite-group-title">Invite people to {roomName}</h2><p className="muted">Links expire after 7 days.</p></div><button type="button" className="close-button" onClick={() => setInviteOpen(false)}>×</button></div>
            <label className="field-label">Who can join?</label>
            <select className="modal-input" value={inviteMode} onChange={(e) => { setInviteMode(e.target.value as "approval" | "instant"); setInviteUrl(""); }}>
              <option value="approval">Approval required — owner/admin approves</option>
              <option value="instant">Instant joining — valid link holders can join</option>
            </select>
            <button type="button" className="full-button" disabled={inviteBusy} onClick={() => void createInvitation()}>{inviteBusy ? "Creating secure link…" : "Generate invitation link"}</button>
            {inviteUrl && <div className="invite-link-box"><input className="modal-input" readOnly value={inviteUrl} aria-label="Invitation link" /><button type="button" className="full-button" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copy invitation link</button><button type="button" className="text-action" disabled={inviteBusy} onClick={() => void revokeInvitation()}>Revoke this link</button></div>}
            <p className="security-note">The link contains no encryption key. A fresh group key is generated and wrapped for every current member and the joining member. New members cannot decrypt earlier messages.</p>
          </section>
        </div>
      )}

      {addOpen && (
        <div className="group-info-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingMembers) setAddOpen(false); }}>
          <section className="group-info-card" role="dialog" aria-modal="true" aria-labelledby="add-members-title">
            <div className="group-info-heading">
              <div><p className="eyebrow">GROUP MEMBERS</p><h2 id="add-members-title">Add people</h2><p className="muted">Search existing Alta Chat usernames</p></div>
              <button type="button" className="close-button" aria-label="Close add members" onClick={() => setAddOpen(false)}>×</button>
            </div>
            <input className="modal-input" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Type at least 2 characters" autoFocus />
            <div className="group-search-results">
              {searching && <p className="muted">Searching…</p>}
              {!searching && memberSearch.trim().length >= 2 && searchResults.length === 0 && <p className="muted">No new people found.</p>}
              {searchResults.map((user) => (
                <label className="member-choice" key={user.id}>
                  <span className="avatar">{user.username.slice(0, 2).toUpperCase()}</span>
                  <span className="group-member-copy"><strong>{user.username}</strong><small>{user.status}</small></span>
                  <input type="checkbox" checked={selectedIds.includes(user.id)} onChange={() => setSelectedIds((ids) => ids.includes(user.id) ? ids.filter((id) => id !== user.id) : [...ids, user.id].slice(0, 50))} />
                </label>
              ))}
              {selectedIds.length > 0 && <p className="muted">{selectedIds.length} selected</p>}
            </div>
            <button type="button" className="full-button" disabled={!selectedIds.length || savingMembers} onClick={() => void addSelectedMembers()}>{savingMembers ? "Updating encryption…" : `Add ${selectedIds.length || ""} member${selectedIds.length === 1 ? "" : "s"}`}</button>
            <p className="security-note">The group key is rotated and securely shared with all current members and the people you add.</p>
          </section>
        </div>
      )}
    </main>
  );
}
