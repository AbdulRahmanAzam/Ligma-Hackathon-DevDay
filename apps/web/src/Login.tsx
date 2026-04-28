import { useState } from "react";

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

interface Props {
  onAuth: () => void;
}

export function Login({ onAuth }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loginAs(s: Seeded) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const room_id = params.get("room") || "ligma-devday-main";
      const r = await fetch("/api/auth/dev-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: s.user_id, room_id }),
      });
      if (!r.ok) throw new Error(`server ${r.status}`);
      const data = (await r.json()) as {
        token: string;
        user_id: string;
        display: string;
        email: string;
        role: "Lead" | "Contributor" | "Viewer";
      };
      window.localStorage.setItem("ligma.token", data.token);
      window.localStorage.setItem("ligma.userId", data.user_id);
      window.localStorage.setItem("ligma.userName", data.display);
      window.localStorage.setItem("ligma.userColor", s.color);
      window.localStorage.setItem("ligma.userRole", data.role);
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0c111c",
        color: "#e6edf3",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif',
      }}
    >
      <div
        style={{
          background: "#131a2a",
          border: "1px solid #243149",
          borderRadius: 12,
          padding: 32,
          minWidth: 360,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "0.04em" }}>LIGMA</h1>
        <p style={{ margin: "0 0 18px", color: "#94a3b8", fontSize: 13 }}>
          Sign in as a seeded demo account. Each gets a real JWT.
        </p>
        {SEEDED.map((s) => (
          <button
            key={s.user_id}
            disabled={busy}
            onClick={() => loginAs(s)}
            style={{
              display: "block",
              width: "100%",
              background: "#1a2236",
              color: "#e6edf3",
              border: `1px solid ${s.role === "Lead" ? "#6366f1" : "#243149"}`,
              padding: "12px 14px",
              marginBottom: 8,
              borderRadius: 8,
              cursor: busy ? "wait" : "pointer",
              textAlign: "left",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          >
            <strong style={{ color: s.color }}>{s.display}</strong>
            <span style={{ color: "#94a3b8", marginLeft: 8 }}>· {s.role}</span>
          </button>
        ))}
        {error && (
          <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>error: {error}</div>
        )}
        <div style={{ color: "#64748b", fontSize: 11, marginTop: 14 }}>
          For multi-user demo: open a second tab and pick a different account.
        </div>
      </div>
    </div>
  );
}
