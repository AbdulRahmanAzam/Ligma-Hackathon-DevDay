import { useEffect, useState } from "react";
import { type DevTokenResponse } from "@ligma/shared";

interface Props {
  onAuth: (token: string, user: { user_id: string; display: string; email: string }) => void;
}

const SEEDED = [
  { user_id: "u_alice", display: "Alice", role: "Lead" },
  { user_id: "u_bob", display: "Bob", role: "Contributor" },
  { user_id: "u_carol", display: "Carol", role: "Viewer" },
];

export function Login({ onAuth }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If a token is in localStorage, try to use it.
    const t = localStorage.getItem("ligma.token");
    const u = localStorage.getItem("ligma.user");
    if (t && u) {
      try {
        const parsed = JSON.parse(u);
        onAuth(t, parsed);
      } catch {
        /* ignore */
      }
    }
  }, [onAuth]);

  async function loginAs(user_id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/dev-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id }),
      });
      if (!r.ok) throw new Error("server rejected token request");
      const data = (await r.json()) as DevTokenResponse;
      localStorage.setItem("ligma.token", data.token);
      const u = { user_id: data.user_id, display: data.display, email: data.email };
      localStorage.setItem("ligma.user", JSON.stringify(u));
      onAuth(data.token, u);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>LIGMA</h1>
        <p>Pick a seeded demo account. Each gets a real JWT.</p>
        {SEEDED.map((s) => (
          <button
            key={s.user_id}
            className={s.role === "Lead" ? "primary" : ""}
            disabled={busy}
            onClick={() => loginAs(s.user_id)}
          >
            <strong>{s.display}</strong>
            <span style={{ color: "#94a3b8", marginLeft: 8 }}>· {s.role}</span>
          </button>
        ))}
        {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
        <div className="hint">
          Two-tab demo: open this page twice, log in as Alice in one and Bob in the other.
        </div>
      </div>
    </div>
  );
}
