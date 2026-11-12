import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { findOwnById, getCryptoPublicKey, getStats, searchUsers, updateEncryptedProfile } from "../models/user.js";
import { profileSchema } from "../validation/auth.js";
import { sendValidationError } from "../validation/respond.js";
import { objectId } from "../validation/rooms.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/", async (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);
  res.json(await searchUsers(q.slice(0, 50), req.userId!));
});

usersRouter.get("/me", async (req: AuthedRequest, res) => {
  const user = await findOwnById(req.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ ...user, stats: await getStats(req.userId!) });
});

usersRouter.patch("/me", async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const user = await updateEncryptedProfile(req.userId!, parsed.data.encryptedProfile);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

usersRouter.get("/:userId/crypto-key", async (req, res) => {
  if (!objectId.safeParse(req.params.userId).success) return res.status(404).json({ error: "User not found" });
  const key = await getCryptoPublicKey(req.params.userId);
  if (!key) return res.status(404).json({ error: "User not found" });
  res.json(key);
});
