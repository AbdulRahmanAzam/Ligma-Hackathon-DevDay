import { useState } from "react";
import "./auth-screens.css";
import { persistSession, quickLogin, signIn, signUp } from "./auth-api";

interface Seeded {
  user_id: string;
  display: string;
  role: "Lead" | "Contributor" | "Viewer";
  color: string;
}

const SEEDED: Seeded[] = [
  { user_id: "u_alice", display: "Alice", role: "Lead", color: "#0ea5e9" },
  { user_id: "u_bob", display: "Bob", role: "Contributor", color: "#f97316" },
  { user_id: "u_carol", display: "Carol", role: "Viewer", color: "#22c55e" },
];

type Tab = "quick" | "signin" | "signup";

interface Props {
  onAuth: () => void;
  defaultTab?: Tab;
  inviteRoomName?: string;
}

export function Login({ onAuth, defaultTab = "quick", inviteRoomName }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-in / sign-up state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [display, setDisplay] = useState("");

  async function quickAs(s: Seeded) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const room_id = params.get("room") || "ligma-devday-main";
      const data = await quickLogin(s.user_id, room_id);
      persistSession(
        data.token,
        {
          user_id: data.user_id,
          email: data.email,
          display: data.display,
          role: data.role,
        },
        s.color,
      );
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doSignIn() {
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signIn(email, password);
      persistSession(r.token, r.user);
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doSignUp() {
    if (!email || !password || !display) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await signUp(email, password, display);
      persistSession(r.token, r.user);
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ligma-shell" style={{ display: "grid", placeItems: "center" }}>
      <div className="ligma-card" style={{ minWidth: 380, maxWidth: 420 }}>
        <h1 className="ligma-h1">LIGMA</h1>
        <div className="ligma-mute" style={{ marginBottom: 16 }}>
          {inviteRoomName
            ? `Sign in to join "${inviteRoomName}".`
            : "Sign in or create an account to start."}
        </div>

        <div className="tabs">
          <button className={`tab ${tab === "quick" ? "active" : ""}`} onClick={() => setTab("quick")}>
            Quick
          </button>
          <button className={`tab ${tab === "signin" ? "active" : ""}`} onClick={() => setTab("signin")}>
            Sign in
          </button>
          <button className={`tab ${tab === "signup" ? "active" : ""}`} onClick={() => setTab("signup")}>
            Sign up
          </button>
        </div>

        {tab === "quick" && (
          <div>
            <div className="ligma-mute" style={{ marginBottom: 10 }}>
              Demo accounts (each gets a real JWT):
            </div>
            {SEEDED.map((s) => (
              <button
                key={s.user_id}
                disabled={busy}
                onClick={() => quickAs(s)}
                className="ligma-btn"
                style={{
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 8,
                  borderColor: s.role === "Lead" ? "#6366f1" : "#243149",
                }}
              >
                <strong style={{ color: s.color }}>{s.display}</strong>
                <span style={{ color: "#94a3b8", marginLeft: 8 }}>· {s.role}</span>
              </button>
            ))}
          </div>
        )}

        {tab === "signin" && (
          <div>
            <input
              className="ligma-input"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <input
              className="ligma-input"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSignIn();
              }}
            />
            <button className="ligma-btn primary" style={{ width: "100%" }} onClick={doSignIn} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        )}

        {tab === "signup" && (
          <div>
            <input
              className="ligma-input"
              type="text"
              autoComplete="name"
              placeholder="Display name"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
              disabled={busy}
            />
            <input
              className="ligma-input"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <input
              className="ligma-input"
              type="password"
              autoComplete="new-password"
              placeholder="Password (8+ chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSignUp();
              }}
            />
            <button className="ligma-btn primary" style={{ width: "100%" }} onClick={doSignUp} disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </div>
        )}

        {error && <div className="error-pill">{error}</div>}

        <div className="ligma-mute" style={{ fontSize: 11, marginTop: 14 }}>
          Multi-user demo: open a second tab, switch accounts there.
        </div>
      </div>
    </div>
  );
}
