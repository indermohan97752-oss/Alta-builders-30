import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { clearSessionCookie, requireAuth, setSessionCookie, type AuthedRequest } from "../middleware/auth.js";
import { AdminBootstrapClaimModel, UserModel } from "../models/schemas.js";
import { createUser, findCredentialsByUsername, findTaken, isUniqueViolation, revokeAllSessions } from "../models/user.js";
import { dummyHash, hashPassword, verifyPassword } from "../services/password.js";
import { disconnectUserSockets } from "../services/realtime.js";
import { loginSchema, signupSchema } from "../validation/auth.js";

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", fields: parsed.error.flatten().fieldErrors });
  const { username, password, adminBootstrapToken, ...cryptoData } = parsed.data;

  if (adminBootstrapToken) {
    const expected = Buffer.from(config.adminBootstrapToken ?? "", "utf8");
    const supplied = Buffer.from(adminBootstrapToken, "utf8");
    if (!config.adminBootstrapToken || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(403).json({ error: "Invalid admin setup key" });
    }
    if (await AdminBootstrapClaimModel.exists({ _id: "global-admin" })) {
      return res.status(409).json({ error: "The first admin account has already been created" });
    }
  }

  if (await findTaken(username)) return res.status(409).json({ error: "That username is already in use" });
  const passwordHash = await hashPassword(password);
  try {
    const user = await createUser({ username, passwordHash, ...cryptoData });
    if (adminBootstrapToken) {
      try {
        await AdminBootstrapClaimModel.create({ _id: "global-admin", userId: user.id });
      } catch (claimError) {
        if (isUniqueViolation(claimError)) {
          return res.status(409).json({ error: "Admin setup was already claimed. This account was created as a regular user; log in to continue." });
        }
        throw claimError;
      }
      const promoted = await UserModel.updateOne({ _id: user.id }, { $set: { role: "admin" } });
      if (promoted.matchedCount !== 1) throw new Error("Admin account promotion failed");
      user.role = "admin";
    }
    setSessionCookie(res, user.id, user.session_version);
    const { session_version: _sessionVersion, ...publicUser } = user;
    return res.status(201).json({ user: publicUser });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: "That username is already in use" });
    throw err;
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", fields: parsed.error.flatten().fieldErrors });
  const { username, password } = parsed.data;
  const found = await findCredentialsByUsername(username);
  const ok = await verifyPassword(password, found?.password_hash ?? (await dummyHash()));
  if (!found || !ok) return res.status(401).json({ error: "Invalid username or password" });
  if (!found.crypto_salt || !found.crypto_public_key || !found.wrapped_private_key || !found.encrypted_profile) {
    return res.status(409).json({ error: "This account uses the legacy data format. Back up the old database and migrate to a new E2EE database before signing in." });
  }

  const { password_hash: _omit, ...user } = found;
  setSessionCookie(res, user.id, user.session_version);
  const { session_version: _sessionVersion, ...publicUser } = user;
  return res.json({ user: publicUser });
});

authRouter.post("/logout", requireAuth, async (req: AuthedRequest, res) => {
  await revokeAllSessions(req.userId!);
  disconnectUserSockets(req.userId!);
  clearSessionCookie(res);
  return res.status(204).end();
});
