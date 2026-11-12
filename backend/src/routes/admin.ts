import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { MessageModel, RoomModel, UserModel } from "../models/schemas.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.get("/overview", async (_req, res) => {
  const [users, rooms, messages, admins] = await Promise.all([
    UserModel.countDocuments(),
    RoomModel.countDocuments(),
    MessageModel.countDocuments(),
    UserModel.countDocuments({ role: "admin" }),
  ]);
  return res.json({ users, rooms, messages, admins });
});
