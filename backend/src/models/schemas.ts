import mongoose, { Schema } from "mongoose";

const ObjectId = Schema.Types.ObjectId;
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const encryptedBlobSchema = new Schema(
  { iv: { type: String, required: true, minlength: 16, maxlength: 16 }, ciphertext: { type: String, required: true, minlength: 24, maxlength: 32_768 } },
  { _id: false },
);
const wrappedPrivateKeySchema = new Schema(
  {
    iv: { type: String, required: true, minlength: 16, maxlength: 16 },
    ciphertext: { type: String, required: true, minlength: 24, maxlength: 16_384 },
    iterations: { type: Number, required: true, min: 300_000, max: 2_000_000 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    username: { type: String, required: true, trim: true, match: /^[A-Za-z0-9_]{3,30}$/ },
    usernameLower: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false, match: [BCRYPT, "passwordHash must be a bcrypt hash"] },
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    sessionVersion: { type: Number, required: true, default: 0, min: 0 },
    cryptoPublicKey: { type: Schema.Types.Mixed, required: true },
    cryptoSalt: { type: String, required: true, minlength: 20, maxlength: 64 },
    wrappedPrivateKey: { type: wrappedPrivateKeySchema, required: true },
    encryptedProfile: { type: encryptedBlobSchema, required: true },
    status: { type: String, enum: ["online", "away", "offline"], default: "offline" },
    lastSeenAt: { type: Date },
  },
  { collection: "users", timestamps: { createdAt: true, updatedAt: false } },
);
userSchema.pre("validate", function () {
  if (this.username) this.usernameLower = this.username.toLowerCase();
});

const adminBootstrapClaimSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: ObjectId, ref: "User", required: true },
    claimedAt: { type: Date, default: Date.now },
  },
  { collection: "system_claims" },
);

const memberSchema = new Schema(
  {
    user: { type: ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "member"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
    lastReadMessageId: { type: ObjectId, default: null },
    isMuted: { type: Boolean, default: false },
  },
  { _id: false },
);
const keyEnvelopeSchema = new Schema(
  {
    user: { type: ObjectId, ref: "User", required: true },
    wrappedKey: { type: String, required: true, minlength: 512, maxlength: 512 },
    keyVersion: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);
const roomSchema = new Schema(
  {
    type: { type: String, enum: ["direct", "group"], required: true },
    encryptedMetadata: { type: encryptedBlobSchema, required: true },
    keyEnvelopes: { type: [keyEnvelopeSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    currentKeyVersion: { type: Number, required: true, min: 1, default: 1 },
    membershipRevision: { type: Number, required: true, min: 0, default: 0 },
    dmKey: { type: String, unique: true, sparse: true },
    createdBy: { type: ObjectId, ref: "User" },
    members: { type: [memberSchema], default: [] },
  },
  { collection: "rooms", timestamps: { createdAt: true, updatedAt: false } },
);
roomSchema.index({ "members.user": 1 });
roomSchema.pre("validate", function () {
  const ownerCount = this.members.filter((member: any) => member.role === "owner").length;
  if (this.type === "group" && ownerCount !== 1) this.invalidate("members", "A group must have exactly one owner");
  if (this.type === "direct" && ownerCount !== 0) this.invalidate("members", "Direct chat participants cannot hold group owner roles");
  if (this.type === "direct" && this.members.length !== 2) this.invalidate("members", "A direct chat must have exactly two participants");
});

const messageSchema = new Schema(
  {
    room: { type: ObjectId, ref: "Room", required: true },
    sender: { type: ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["text", "image", "file", "system"], default: "text" },
    content: { type: String, maxlength: 500 },
    encryptedContent: { type: String, minlength: 24, maxlength: 16_384 },
    encryptedIv: { type: String, minlength: 16, maxlength: 16 },
    encryptionVersion: { type: Number, min: 1 },
    replyTo: { type: ObjectId, ref: "Message", default: null },
    editedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { collection: "messages", timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ room: 1, _id: -1 });
messageSchema.pre("validate", function () {
  if (this.type === "system") return;
  if (!this.encryptedContent || !this.encryptedIv || !this.encryptionVersion || this.content) {
    this.invalidate("encryptedContent", "User messages must be encrypted before storage");
  }
});

export const UserModel = mongoose.model("User", userSchema);
export const AdminBootstrapClaimModel = mongoose.model("AdminBootstrapClaim", adminBootstrapClaimSchema);
export const RoomModel = mongoose.model("Room", roomSchema);

const groupInvitationSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    room: { type: ObjectId, ref: "Room", required: true, index: true },
    createdBy: { type: ObjectId, ref: "User", required: true },
    mode: { type: String, enum: ["approval", "instant"], required: true },
    displayName: { type: String, required: true, minlength: 1, maxlength: 60 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
    requests: {
      type: [{
        user: { type: ObjectId, ref: "User", required: true },
        requestedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
  },
  { collection: "group_invitations", timestamps: { createdAt: true, updatedAt: true } },
);
groupInvitationSchema.index({ room: 1, createdAt: -1 });

export const GroupInvitationModel = mongoose.model("GroupInvitation", groupInvitationSchema);
export const MessageModel = mongoose.model("Message", messageSchema);
