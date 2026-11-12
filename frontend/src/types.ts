export interface CipherBlob { iv: string; ciphertext: string }
export interface KeyEnvelope { key_version: number; wrapped_key: string }

export interface Room {
  id: string;
  type: "direct" | "group";
  encrypted_metadata: CipherBlob;
  key_envelopes: KeyEnvelope[];
  current_key_version: number;
  role: "owner" | "admin" | "member";
  last_content: string | null;
  last_sender: string | null;
  last_at: string | null;
  unread: number;
  is_muted: boolean;
  name?: string;
}

export interface RoomDetails extends Room {
  members: Array<{ user_id: string; username: string; status: string; role: string; joined_at: string }>;
}

export interface Message {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string | null;
  type: "text" | "image" | "file" | "system";
  content: string | null;
  encrypted_content: string | null;
  encrypted_iv: string | null;
  encryption_version: number | null;
  reply_to_id: string | null;
  created_at: string;
  display_content?: string;
}

export interface Me {
  id: string;
  username: string;
  role: "user" | "admin";
  status: string;
  encrypted_profile: CipherBlob;
  crypto_public_key: JsonWebKey;
  stats: { rooms: number; sent_today: number };
}
