import { useState, useEffect } from "react";
import { options, emoji } from "./app.js";
import * as api from "./api.js";
import Auth from "./Auth.jsx";
import "./App.css";

const KEY = "rps-room";

function ScoreBox({ label, value }) {
  return (
    <div className="score">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [roomId, setRoomId] = useState(() => sessionStorage.getItem(KEY));
  const [game, setGame] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Am I already logged in? (the browser sends the cookie automatically)
  useEffect(() => {
    api.me().then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  function enterRoom(id) {
    sessionStorage.setItem(KEY, id);
    setGame(null);
    setError("");
    setRoomId(id);
  }

  function leaveRoom() {
    sessionStorage.removeItem(KEY);
    setGame(null);
    setRoomId(null);
  }

  // Poll the server every second for the latest game state
  useEffect(() => {
    if (!roomId || !user) return;
    let stopped = false;

    async function poll() {
      try {
        const data = await api.getState(roomId);
        if (!stopped) {
          setGame(data);
          setError("");
        }
      } catch (e) {
        if (stopped) return;
        if (e.status === 401) setUser(null); // login expired
        else if (e.status === 403 || e.status === 404) leaveRoom(); // not my room / room is gone
        else setError("Connection problem, retrying...");
      }
    }

    poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [roomId, user?.id]);

  // Load "my rooms" whenever the lobby is shown
  useEffect(() => {
    if (!user || roomId) return;
    api.myRooms().then((d) => setRooms(d.rooms)).catch(() => {});
  }, [user?.id, roomId]);

  // Refresh lifetime stats after each round
  useEffect(() => {
    if (game?.phase === "reveal") api.me().then((d) => setUser(d.user)).catch(() => {});
  }, [game?.phase, game?.score.p1, game?.score.p2, game?.score.draws]);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401) setUser(null);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const r = await run(api.createRoom);
    if (r) enterRoom(r.roomId);
  }

  async function join() {
    const r = await run(() => api.joinRoom(code));
    if (r) enterRoom(r.roomId);
  }

  async function removeRoom(id) {
    const r = await run(() => api.deleteRoom(id));
    if (r) setRooms((list) => list.filter((x) => x.roomId !== id));
  }

  async function pick(choice) {
    const g = await run(() => api.choose(roomId, choice));
    if (g) setGame(g);
  }

  async function next() {
    const g = await run(() => api.nextRound(roomId));
    if (g) setGame(g);
  }

  async function reset() {
    const g = await run(() => api.resetScore(roomId));
    if (g) setGame(g);
  }

  async function signOut() {
    await api.logout().catch(() => {});
    leaveRoom();
    setRooms([]);
    setUser(null);
  }

  // ---------- Login ----------
  if (user === undefined) return <main><p className="sub">Loading...</p></main>;
  if (user === null) return <Auth onAuthed={setUser} />;

  const userBar = (
    <div className="userbar">
      <span>
        <b>{user.username}</b> · {user.wins}W {user.losses}L {user.draws}D
      </span>
      <button onClick={signOut}>Sign out</button>
    </div>
  );

  // ---------- Lobby ----------
  if (!roomId) {
    return (
      <main>
        {userBar}
        <h1>Rock Paper Scissors</h1>
        <p className="sub">Play with a friend on another device</p>

        <div className="lobby">
          <button className="primary" disabled={busy} onClick={create}>
            Create room
          </button>
          <div className="or">or join a friend</div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Room code"
            maxLength={6}
          />
          <button disabled={busy || code.length < 6} onClick={join}>
            Join room
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {rooms.length > 0 && (
          <div className="roomlist">
            <h3>Your rooms</h3>
            {rooms.map((r) => (
              <div className="roomitem" key={r.roomId}>
                <div>
                  <b className="code small">{r.roomId}</b>
                  <small>
                    {r.opponent ? `vs ${r.opponent}` : "waiting for opponent"} · {r.score.you}-{r.score.opponent}
                  </small>
                </div>
                <div className="actions">
                  <button onClick={() => enterRoom(r.roomId)}>Open</button>
                  {r.role === "p1" && (
                    <button disabled={busy} onClick={() => removeRoom(r.roomId)}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    );
  }

  // ---------- Game ----------
  const role = game?.role;
  const other = role === "p1" ? "p2" : "p1";
  const round = game?.round;
  const opponentJoined = game?.playersJoined.p2;
  const canChoose = game && opponentJoined && game.phase === "choosing" && !game.youChose;

  let result = "";
  if (round) {
    result = round.winner === "draw" ? "It's a draw" : round.winner === role ? "You win!" : "You lose";
  }
  const resultClass = !round ? "" : round.winner === "draw" ? "draw" : round.winner === role ? "win" : "lose";

  let status = "Connecting...";
  if (game) {
    if (!opponentJoined) status = "Waiting for opponent to join...";
    else if (game.phase === "choosing" && game.youChose) status = "Waiting for opponent to choose...";
    else if (game.phase === "choosing") status = game.opponentChose ? "Opponent has chosen. Your move!" : "Make your move";
  }

  return (
    <main>
      {userBar}
      <h1>Rock Paper Scissors</h1>

      <div className="room">
        Room code: <b className="code">{roomId}</b>
        {game && <small>You are Player {role === "p1" ? "1" : "2"}</small>}
      </div>

      {game && (
        <div className="scores">
          <ScoreBox label="You" value={game.score[role]} />
          <ScoreBox label="Draws" value={game.score.draws} />
          <ScoreBox label="Opponent" value={game.score[other]} />
        </div>
      )}

      <div className="arena">
        {round ? (
          <>
            <div className="picks">
              <span>{emoji[round[role]]}</span>
              <small>vs</small>
              <span>{emoji[round[other]]}</span>
            </div>
            <div className={`result ${resultClass}`}>{result}</div>
          </>
        ) : (
          <div className="status">{status}</div>
        )}
      </div>

      {canChoose && (
        <div className="choices">
          {options.map((name) => (
            <button key={name} disabled={busy} onClick={() => pick(name)}>
              {emoji[name]}
              <span>{name[0].toUpperCase() + name.slice(1)}</span>
            </button>
          ))}
        </div>
      )}

      {game?.phase === "reveal" && (
        <button className="primary" disabled={busy} onClick={next}>
          Next round
        </button>
      )}

      {error && <div className="error">{error}</div>}

      <div className="footer">
        {role === "p1" && (
          <button onClick={reset} disabled={!opponentJoined}>Reset score</button>
        )}
        <button onClick={leaveRoom}>Back to lobby</button>
      </div>
    </main>
  );
}
