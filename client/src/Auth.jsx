import { useState } from "react";
import * as api from "./api.js";

// Login / register screen. Log in with email or mobile number + password.
// Passwords can only contain letters and numbers.
const EMAIL_MAX = 50;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 30;

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const registering = mode === "register";

  async function submit(e) {
    e.preventDefault();
    if (registering && password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} letters or numbers`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = registering
        ? await api.register(username.trim(), identifier.trim(), password)
        : await api.login(identifier.trim(), password);
      onAuthed(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Rock Paper Scissors</h1>
      <p className="sub">{registering ? "Create an account" : "Log in to play"}</p>

      <form className="lobby" onSubmit={submit}>
        {registering && (
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Name (3-20 letters, numbers, _)"
            autoComplete="nickname"
            maxLength={20}
          />
        )}
        <input
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="Email or mobile number"
          autoComplete="username"
          inputMode="email"
          maxLength={EMAIL_MAX}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} // letters and numbers only
          placeholder={registering ? `Password (${PASSWORD_MIN}+ letters or numbers)` : "Password"}
          autoComplete={registering ? "new-password" : "current-password"}
          maxLength={PASSWORD_MAX}
        />
        <button className="primary" disabled={busy || !identifier || !password || (registering && !username)}>
          {registering ? "Register" : "Log in"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      <button className="link" onClick={() => { setMode(registering ? "login" : "register"); setError(""); }}>
        {registering ? "Already have an account? Log in" : "New here? Create an account"}
      </button>
    </main>
  );
}
