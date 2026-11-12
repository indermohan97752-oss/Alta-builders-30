import mongoose from "mongoose";
import { pathToFileURL } from "url";
import { closeDb, connectDb } from "../db.js";
import { MessageModel, RoomModel, UserModel } from "../models/schemas.js";

// The server-side validators intentionally reject plaintext profile and room
// metadata fields, even if a future route accidentally tries to write them.
const versionKey = { bsonType: ["int", "long", "double"] };
const objectId = { bsonType: "objectId" };
const nullableObjectId = { bsonType: ["objectId", "null"] };
const date = { bsonType: "date" };
const encryptedBlob = {
  bsonType: "object",
  required: ["iv", "ciphertext"],
  additionalProperties: false,
  properties: {
    iv: { bsonType: "string", minLength: 16, maxLength: 16 },
    ciphertext: { bsonType: "string", minLength: 24, maxLength: 32_768 },
  },
};

const validators: Record<string, object> = {
  users: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "username", "usernameLower", "passwordHash", "sessionVersion", "cryptoPublicKey",
        "cryptoSalt", "wrappedPrivateKey", "encryptedProfile", "status", "createdAt",
      ],
      additionalProperties: false,
      properties: {
        _id: objectId,
        __v: versionKey,
        username: { bsonType: "string", pattern: "^[A-Za-z0-9_]{3,30}$" },
        usernameLower: { bsonType: "string", pattern: "^[a-z0-9_]{3,30}$" },
        passwordHash: { bsonType: "string", pattern: "^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$" },
        sessionVersion: { bsonType: ["int", "long", "double"], minimum: 0 },
        cryptoPublicKey: {
          bsonType: "object", required: ["kty", "n", "e"], additionalProperties: false,
          properties: {
            kty: { enum: ["RSA"] },
            n: { bsonType: "string", pattern: "^[A-Za-z0-9_-]{500,520}$" },
            e: { enum: ["AQAB"] },
            alg: { bsonType: "string" },
            ext: { bsonType: "bool" },
            key_ops: { bsonType: "array", items: { bsonType: "string" } },
          },
        },
        cryptoSalt: { bsonType: "string", minLength: 20, maxLength: 64 },
        wrappedPrivateKey: {
          bsonType: "object", required: ["iv", "ciphertext", "iterations"], additionalProperties: false,
          properties: {
            iv: { bsonType: "string", minLength: 16, maxLength: 16 },
            ciphertext: { bsonType: "string", minLength: 24, maxLength: 16_384 },
            iterations: { bsonType: ["int", "long", "double"], minimum: 300_000, maximum: 2_000_000 },
          },
        },
        encryptedProfile: encryptedBlob,
        status: { enum: ["online", "away", "offline"] },
        lastSeenAt: date,
        createdAt: date,
      },
    },
  },
  rooms: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          required: ["type", "encryptedMetadata", "keyEnvelopes", "currentKeyVersion", "membershipRevision", "members", "createdAt"],
          additionalProperties: false,
          properties: {
            _id: objectId,
            __v: versionKey,
            type: { enum: ["direct", "group"] },
            encryptedMetadata: encryptedBlob,
            keyEnvelopes: {
              bsonType: "array", minItems: 1,
              items: {
                bsonType: "object", required: ["user", "wrappedKey", "keyVersion"], additionalProperties: false,
                properties: {
                  user: objectId,
                  wrappedKey: { bsonType: "string", minLength: 512, maxLength: 512 },
                  keyVersion: { bsonType: ["int", "long", "double"], minimum: 1 },
                },
              },
            },
            currentKeyVersion: { bsonType: ["int", "long", "double"], minimum: 1 },
            membershipRevision: { bsonType: ["int", "long", "double"], minimum: 0 },
            dmKey: { bsonType: "string" },
            createdBy: objectId,
            members: {
              bsonType: "array", minItems: 1,
              items: {
                bsonType: "object", required: ["user", "role", "joinedAt", "lastReadMessageId", "isMuted"], additionalProperties: false,
                properties: {
                  user: objectId,
                  role: { enum: ["owner", "admin", "member"] },
                  joinedAt: date,
                  lastReadMessageId: nullableObjectId,
                  isMuted: { bsonType: "bool" },
                },
              },
            },
            createdAt: date,
          },
        },
      },
      {
        $or: [
          { type: "direct", dmKey: { $type: "string" } },
          { type: "group", dmKey: { $exists: false } },
        ],
      },
    ],
  },
  messages: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          required: ["room", "sender", "type", "replyTo", "createdAt"],
          additionalProperties: false,
          properties: {
            _id: objectId,
            __v: versionKey,
            room: objectId,
            sender: objectId,
            type: { enum: ["text", "image", "file", "system"] },
            content: { bsonType: "string", maxLength: 500 },
            encryptedContent: { bsonType: "string", minLength: 24, maxLength: 16_384 },
            encryptedIv: { bsonType: "string", minLength: 16, maxLength: 16 },
            encryptionVersion: { bsonType: ["int", "long", "double"], minimum: 1 },
            replyTo: nullableObjectId,
            editedAt: date,
            deletedAt: date,
            createdAt: date,
          },
        },
      },
      {
        $or: [
          { type: "system", content: { $type: "string" }, encryptedContent: { $exists: false }, encryptedIv: { $exists: false }, encryptionVersion: { $exists: false } },
          { type: { $in: ["text", "image", "file"] }, encryptedContent: { $type: "string" }, encryptedIv: { $type: "string" }, encryptionVersion: { $gte: 1 }, content: { $exists: false } },
        ],
      },
    ],
  },
};

/** Idempotent: creates collections, applies strict validators, and builds declared indexes. */
export async function initDatabase(): Promise<void> {
  const models = [UserModel, RoomModel, MessageModel];
  await Promise.all(models.map((model) => model.init()));

  const db = mongoose.connection.db!;
  for (const [name, validator] of Object.entries(validators)) {
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  }
  // Model.init() creates declared indexes. Avoid syncIndexes() at startup: it can
  // drop indexes managed separately by an operator.
  console.log("Database ready: encrypted-data validators and schema indexes are in place");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  connectDb(process.env.MONGODB_ADMIN_URI || undefined)
    .then(initDatabase)
    .catch((err) => { console.error("Database init failed:", err.message); process.exitCode = 1; })
    .finally(closeDb);
}
