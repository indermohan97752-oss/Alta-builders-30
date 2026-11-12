/** Mongo documents -> deliberately minimal public JSON. */
export const toPublicUser = (u: any) => ({
  id: String(u._id),
  username: u.username as string,
  role: (u.role ?? "user") as "user" | "admin",
  status: u.status as "online" | "away" | "offline",
  created_at: u.createdAt as Date,
});

export const toUserLite = (u: any) => ({
  id: String(u._id),
  username: u.username as string,
  status: u.status as "online" | "away" | "offline",
});

export const toRoom = (r: any) => ({
  id: String(r._id),
  type: r.type as "direct" | "group",
  encrypted_metadata: r.encryptedMetadata,
  created_at: r.createdAt as Date,
});

export const toMessage = (m: any, sender?: any) => {
  const s = sender ?? (typeof m.sender === "object" && m.sender?.username ? m.sender : null);
  return {
    id: String(m._id),
    room_id: String(m.room),
    sender_id: String(s?._id ?? m.sender),
    sender_name: s ? (s.username as string) : null,
    type: m.type as "text" | "image" | "file" | "system",
    content: m.type === "system" ? (m.content ?? null) : null,
    encrypted_content: m.encryptedContent ?? null,
    encrypted_iv: m.encryptedIv ?? null,
    encryption_version: m.encryptionVersion ?? null,
    attachment_url: null,
    reply_to_id: m.replyTo ? String(m.replyTo) : null,
    created_at: m.createdAt as Date,
    edited_at: (m.editedAt ?? null) as Date | null,
  };
};
