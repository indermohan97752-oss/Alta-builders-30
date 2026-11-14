import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { cacheRoomKey, createRoomKey, decryptInvitationLabel, encryptRoomMetadataWithKey, getCurrentUserId, wrapRoomKeyForUser } from "../crypto";

type InviteInfo = {
  roomId: string;
  displayName: string;
  mode: "approval" | "instant";
  memberIds: string[];
  currentKeyVersion: number;
  alreadyMember: boolean;
  requested: boolean;
};
type PublicKeyResponse = { public_key: JsonWebKey };

export default function InviteJoinPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void api<InviteInfo>(`/invitations/${encodeURIComponent(token)}`)
      .then(async (data) => {
        const displayName = await decryptInvitationLabel(token, data.displayName);
        setInvite({ ...data, displayName });
        if (data.alreadyMember) setStatus("You are already a member of this group.");
        else if (data.requested) setStatus("Your request is waiting for an owner or admin to approve it.");
      })
      .catch((err) => setError((err as Error).message));
  }, [token]);

  async function join() {
    if (!invite || busy) return;
    setBusy(true);
    setError("");
    try {
      if (invite.mode === "approval") {
        const result = await api<{ status: string }>(`/invitations/${encodeURIComponent(token)}/join`, { method: "POST", body: JSON.stringify({}) });
        setStatus(result.status === "member" ? "You are already a member." : "Request sent. You'll be able to open the group after an admin approves you.");
        return;
      }
      const userId = getCurrentUserId();
      if (!userId) throw new Error("Your account encryption is locked. Log in again before joining.");
      const recipients = [...new Set([...invite.memberIds, userId])];
      const keys = await Promise.all(recipients.map(async (id) => ({
        userId: id,
        publicKey: (await api<PublicKeyResponse>(`/users/${id}/crypto-key`)).public_key,
      })));
      const { raw, key } = await createRoomKey();
      try {
        const encryptedMetadata = await encryptRoomMetadataWithKey(key, { name: invite.displayName });
        const keyEnvelopes = await Promise.all(keys.map(async (entry) => ({
          userId: entry.userId,
          wrappedKey: await wrapRoomKeyForUser(raw, entry.publicKey),
        })));
        const result = await api<{ status?: string; keyVersion?: number }>(`/invitations/${encodeURIComponent(token)}/join`, {
          method: "POST",
          body: JSON.stringify({ encryptedMetadata, keyEnvelopes }),
        });
        if (result.status === "member") {
          navigate(`/rooms/${invite.roomId}`);
          return;
        }
        cacheRoomKey(invite.roomId, result.keyVersion ?? invite.currentKeyVersion + 1, key);
        navigate(`/rooms/${invite.roomId}`);
      } finally {
        raw.fill(0);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!invite && !error) return <main className="screen"><p className="muted">Checking invitation…</p></main>;
  return (
    <main className="screen auth-screen">
      <section className="auth-card">
        <p className="eyebrow">ALTA CHAT · GROUP INVITATION</p>
        <h1>{invite?.displayName ?? "Invitation unavailable"}</h1>
        {invite && <p className="muted">{invite.mode === "approval" ? "This group requires approval from an owner or admin." : "This invitation allows instant joining. Your browser will securely rotate the group encryption key."}</p>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        {status && <p className="security-note" role="status">{status}</p>}
        {invite?.alreadyMember ? <Link className="full-button" to={`/rooms/${invite.roomId}`}>Open group</Link>
          : invite?.requested ? <Link className="full-button" to="/">Back to Alta Chat</Link>
          : invite && <button className="full-button" type="button" onClick={() => void join()} disabled={busy}>{busy ? "Joining securely…" : invite.mode === "approval" ? "Request to join" : "Join group now"}</button>}
        <p className="security-note">The invitation never contains a group encryption key. New members receive a fresh key version, not access to earlier messages.</p>
        <Link to="/">Return to Alta Chat</Link>
      </section>
    </main>
  );
}
