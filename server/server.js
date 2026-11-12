import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { Op } from "sequelize";
import { sequelize, Room, Round, User, initDb, write } from "./db.js";
import { authRouter, requireAuth, h } from "./auth.js";
import { adminRouter } from "./admin.js";

const app = express();
app.set("trust proxy", 1); // we run behind the host's proxy (needed for correct client IPs)

// ---------- Security middleware ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { "upgrade-insecure-requests": null }, // the host provides HTTPS
    },
  })
);
app.use(express.json({ limit: "1kb" }));
app.use(cookieParser());

const limitMessage = { error: "Too many requests, slow down" };
const limiterOptions = { windowMs: 60_000, standardHeaders: true, legacyHeaders: false, message: limitMessage };
app.use("/api", rateLimit({ ...limiterOptions, limit: 600 }));
const strictLimiter = rateLimit({ ...limiterOptions, limit: 20 }); // create / join rooms

// CSRF protection (on top of SameSite cookies): changing requests must carry a custom header,
// which other websites can't add to requests made to our server.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") !== "rps") {
    return res.status(403).json({ error: "Missing X-Requested-With header" });
  }
  next();
});

// ---------- Game rules ----------
const options = ["rock", "paper", "scissors"];
const beats = { rock: "scissors", paper: "rock", scissors: "paper" };

function getWinner(p1, p2) {
  if (p1 === p2) return "draw";
  return beats[p1] === p2 ? "p1" : "p2";
}

// ---------- Helpers ----------
const MAX_ROOMS = 5000;
const MAX_ROOMS_PER_USER = 10;
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_HOURS || 24) * 60 * 60 * 1000; // idle rooms are deleted

async function cleanup() {
  try {
    await write((t) =>
      Room.destroy({ where: { updatedAt: { [Op.lt]: new Date(Date.now() - ROOM_TTL_MS) } }, transaction: t })
    );
  } catch (e) {
    console.error("Cleanup failed:", e.message);
  }
}

// 6 characters from an alphabet without look-alikes (no 0/O, 1/I): about 1 billion codes
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeRoomId = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

// Authorization: which seat (if any) does this user have in the room?
function roleOf(room, userId) {
  if (room.p1UserId === userId) return "p1";
  if (room.p2UserId === userId) return "p2";
  return null;
}

// Hides the opponent's choice until the round is revealed
function view(room, role) {
  const other = role === "p1" ? "p2" : "p1";
  const choice = { p1: room.p1Choice, p2: room.p2Choice };
  return {
    roomId: room.id,
    role,
    phase: room.winner ? "reveal" : "choosing",
    playersJoined: { p1: true, p2: Boolean(room.p2UserId) },
    youChose: Boolean(choice[role]),
    opponentChose: Boolean(choice[other]),
    round: room.winner ? { p1: room.p1Choice, p2: room.p2Choice, winner: room.winner } : null,
    score: { p1: room.p1Score, draws: room.drawScore, p2: room.p2Score },
  };
}

const roomIdOf = (req) => String(req.params.roomId).toUpperCase();
const notPlayer = { status: 403, body: { error: "You are not a player in this room" } };

// Read-only lookup + membership check
async function authRead(req, res) {
  const room = await Room.findByPk(roomIdOf(req));
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return {};
  }
  const role = roleOf(room, req.user.id);
  if (!role) {
    res.status(notPlayer.status).json(notPlayer.body);
    return {};
  }
  return { room, role };
}

// Loads a room inside a transaction, runs `work`, and responds after the commit
async function inRoom(req, res, work, { needPlayer = true } = {}) {
  const result = await write(async (t) => {
    const room = await Room.findByPk(roomIdOf(req), { transaction: t, lock: t.LOCK.UPDATE });
    if (!room) return { status: 404, body: { error: "Room not found" } };
    const role = roleOf(room, req.user.id);
    if (needPlayer && !role) return notPlayer;
    return work(room, role, t);
  });
  res.status(result.status).json(result.body);
}

// ---------- Public route ----------
app.get("/api/health", h(async (req, res) => {
  res.json({ status: "ok", database: sequelize.getDialect() });
}));

// ---------- Accounts and admin ----------
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

// ---------- Rooms (login required for everything below) ----------
app.use("/api/rooms", requireAuth);

app.post("/api/rooms", strictLimiter, h(async (req, res) => {
  if ((await Room.count()) >= MAX_ROOMS) {
    return res.status(503).json({ error: "Server is full, try again later" });
  }
  if ((await Room.count({ where: { p1UserId: req.user.id } })) >= MAX_ROOMS_PER_USER) {
    return res.status(429).json({ error: "You have too many rooms. Delete some you no longer need." });
  }
  let id;
  do {
    id = makeRoomId();
  } while (await Room.findByPk(id));
  await write((t) => Room.create({ id, p1UserId: req.user.id }, { transaction: t }));
  res.status(201).json({ roomId: id, role: "p1" });
}));

// Rooms I'm in (must be defined before the /:roomId routes)
app.get("/api/rooms/mine", h(async (req, res) => {
  const uid = req.user.id;
  const rooms = await Room.findAll({
    where: { [Op.or]: [{ p1UserId: uid }, { p2UserId: uid }] },
    include: [
      { model: User, as: "p1", attributes: ["username"] },
      { model: User, as: "p2", attributes: ["username"] },
    ],
    order: [["updatedAt", "DESC"]],
    limit: 20,
  });
  res.json({
    rooms: rooms.map((r) => {
      const role = r.p1UserId === uid ? "p1" : "p2";
      const other = role === "p1" ? "p2" : "p1";
      return {
        roomId: r.id,
        role,
        opponent: r[other]?.username ?? null,
        score: { you: r[`${role}Score`], draws: r.drawScore, opponent: r[`${other}Score`] },
        updatedAt: r.updatedAt,
      };
    }),
  });
}));

app.post("/api/rooms/:roomId/join", strictLimiter, h((req, res) =>
  inRoom(req, res, async (room, role, t) => {
    if (role === "p1") return { status: 400, body: { error: "You can't join your own room" } };
    if (role === "p2") return { status: 200, body: { roomId: room.id, role: "p2" } }; // already in
    if (room.p2UserId) return { status: 409, body: { error: "Room is full" } };
    room.p2UserId = req.user.id;
    await room.save({ transaction: t });
    return { status: 200, body: { roomId: room.id, role: "p2" } };
  }, { needPlayer: false })
));

app.get("/api/rooms/:roomId", h(async (req, res) => {
  const { room, role } = await authRead(req, res);
  if (!room) return;
  res.json(view(room, role));
}));

// Finished rounds, newest first
app.get("/api/rooms/:roomId/history", h(async (req, res) => {
  const { room } = await authRead(req, res);
  if (!room) return;
  const rounds = await Round.findAll({ where: { roomId: room.id }, order: [["id", "DESC"]], limit: 50 });
  res.json({
    roomId: room.id,
    rounds: rounds.map((r) => ({ round: r.id, p1: r.p1Choice, p2: r.p2Choice, winner: r.winner, playedAt: r.createdAt })),
  });
}));

app.post("/api/rooms/:roomId/choose", h((req, res) =>
  inRoom(req, res, async (room, role, t) => {
    const choice = req.body?.choice;
    if (!room.p2UserId) return { status: 409, body: { error: "Waiting for Player 2 to join" } };
    if (!options.includes(choice)) {
      return { status: 400, body: { error: `choice must be one of: ${options.join(", ")}` } };
    }
    if (room.winner) return { status: 409, body: { error: "Round is finished. Call /next first" } };
    if (room[`${role}Choice`]) return { status: 409, body: { error: "You already chose this round" } };

    room[`${role}Choice`] = choice;

    if (room.p1Choice && room.p2Choice) {
      const winner = getWinner(room.p1Choice, room.p2Choice);
      room.winner = winner;
      room[winner === "draw" ? "drawScore" : `${winner}Score`] += 1;
      await Round.create(
        { roomId: room.id, p1Choice: room.p1Choice, p2Choice: room.p2Choice, winner },
        { transaction: t }
      );
      // Lifetime stats on the accounts
      const bump = (field, userId) => User.increment(field, { where: { id: userId }, transaction: t });
      if (winner === "draw") {
        await bump("draws", room.p1UserId);
        await bump("draws", room.p2UserId);
      } else {
        const winnerId = winner === "p1" ? room.p1UserId : room.p2UserId;
        const loserId = winner === "p1" ? room.p2UserId : room.p1UserId;
        await bump("wins", winnerId);
        await bump("losses", loserId);
      }
    }
    await room.save({ transaction: t });
    return { status: 200, body: view(room, role) };
  })
));

app.post("/api/rooms/:roomId/next", h((req, res) =>
  inRoom(req, res, async (room, role, t) => {
    if (!room.winner) return { status: 409, body: { error: "Round is not finished yet" } };
    room.p1Choice = null;
    room.p2Choice = null;
    room.winner = null;
    await room.save({ transaction: t });
    return { status: 200, body: view(room, role) };
  })
));

// Only the room creator may reset the score
app.post("/api/rooms/:roomId/reset", h((req, res) =>
  inRoom(req, res, async (room, role, t) => {
    if (role !== "p1") return { status: 403, body: { error: "Only the room creator can reset the score" } };
    Object.assign(room, { p1Choice: null, p2Choice: null, winner: null, p1Score: 0, drawScore: 0, p2Score: 0 });
    await room.save({ transaction: t });
    await Round.destroy({ where: { roomId: room.id }, transaction: t });
    return { status: 200, body: view(room, role) };
  })
));

// Only the room creator may delete the room
app.delete("/api/rooms/:roomId", h((req, res) =>
  inRoom(req, res, async (room, role, t) => {
    if (role !== "p1") return { status: 403, body: { error: "Only the room creator can delete the room" } };
    await room.destroy({ transaction: t });
    return { status: 200, body: { ok: true } };
  })
));

app.use("/api", (req, res) => res.status(404).json({ error: "Route not found" }));

// ---------- Serve the built React app (production) ----------
const dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(dirname, "../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
}

// ---------- Errors ----------
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Body too large" });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const PORT = process.env.PORT || 3001;
try {
  await initDb();
} catch (e) {
  console.error("Could not start the database:", e.message);
  process.exit(1);
}
await cleanup();
setInterval(cleanup, 10 * 60 * 1000);
app.listen(PORT, () => console.log(`RPS server running on port ${PORT} (database: ${sequelize.getDialect()})`));
