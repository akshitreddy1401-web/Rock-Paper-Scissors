// api.js: talks to the Express server. Login is kept in an httpOnly cookie the browser sends automatically.
const BASE = "/api";

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "rps" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // No JSON in the reply means the request never reached our API (usually the server stopped or crashed)
    const err = new Error(data?.error || `Cannot reach the server (error ${res.status}). Check the server terminal for the reason.`);
    err.status = res.status;
    throw err;
  }
  return data ?? {};
}

const code = (roomId) => encodeURIComponent(roomId.trim().toUpperCase());

// accounts
export const register = (username, identifier, password) =>
  call("/auth/register", { method: "POST", body: { username, identifier, password } });
export const login = (identifier, password) => call("/auth/login", { method: "POST", body: { identifier, password } });
export const logout = () => call("/auth/logout", { method: "POST" });
export const me = () => call("/auth/me");

// rooms
export const createRoom = () => call("/rooms", { method: "POST" });
export const myRooms = () => call("/rooms/mine");
export const joinRoom = (roomId) => call(`/rooms/${code(roomId)}/join`, { method: "POST" });
export const getState = (roomId) => call(`/rooms/${roomId}`);
export const choose = (roomId, choice) => call(`/rooms/${roomId}/choose`, { method: "POST", body: { choice } });
export const nextRound = (roomId) => call(`/rooms/${roomId}/next`, { method: "POST" });
export const resetScore = (roomId) => call(`/rooms/${roomId}/reset`, { method: "POST" });
export const deleteRoom = (roomId) => call(`/rooms/${roomId}`, { method: "DELETE" });
