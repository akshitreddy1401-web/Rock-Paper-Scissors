// admin.js: routes only for users with the "admin" role
import { Router } from "express";
import { User, Room, write } from "./db.js";
import { requireAuth, requireRole, h } from "./auth.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("admin"));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

adminRouter.get("/users", h(async (req, res) => {
  const users = await User.findAll({
    attributes: ["id", "username", "email", "phone", "role", "wins", "losses", "draws", "createdAt"],
    order: [["createdAt", "ASC"]],
  });
  res.json({ users });
}));

adminRouter.get("/rooms", h(async (req, res) => {
  const rooms = await Room.findAll({
    include: [
      { model: User, as: "p1", attributes: ["username"] },
      { model: User, as: "p2", attributes: ["username"] },
    ],
    order: [["updatedAt", "DESC"]],
    limit: 200,
  });
  res.json({
    rooms: rooms.map((r) => ({
      roomId: r.id,
      player1: r.p1?.username ?? null,
      player2: r.p2?.username ?? null,
      score: { p1: r.p1Score, draws: r.drawScore, p2: r.p2Score },
      updatedAt: r.updatedAt,
    })),
  });
}));

adminRouter.delete("/rooms/:roomId", h(async (req, res) => {
  const id = String(req.params.roomId).toUpperCase();
  const count = await write((t) => Room.destroy({ where: { id }, transaction: t }));
  if (!count) return res.status(404).json({ error: "Room not found" });
  res.json({ ok: true });
}));

adminRouter.delete("/users/:id", h(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "User not found" });
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete your own account here" });
  const count = await write((t) => User.destroy({ where: { id }, transaction: t }));
  if (!count) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
}));
