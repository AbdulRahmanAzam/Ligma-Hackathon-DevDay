import { useEffect, useState } from "react";
import "./auth-screens.css";
import { clearSession, createRoom, listMyRooms, readUser, type RoomCard, type SessionUser } from "./auth-api";

interface Props {
  onOpenRoom: (room_id: string) => void;
  onSignOut: () => void;
}

export function Home({ onOpenRoom, onSignOut }: Props) {
  const [user, setUser] = useState<SessionUser | null>(() => readUser());
  const [rooms, setRooms] = useState<RoomCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    setUser(readUser());
    let cancelled = false;
    listMyRooms()
      .then((r) => {
        if (!cancelled) setRooms(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setRooms([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function signOut() {
    clearSession();
    onSignOut();
  }

  async function handleCreate(name: string, default_role: "Contributor" | "Viewer") {
    setCreating(true);
    setError(null);
    try {
      const r = await createRoom(name, default_role);
      setShowNew(false);
      onOpenRoom(r.room_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="ligma-shell">
      <div className="home-shell">
        <div className="home-header">
          <h1 className="ligma-h1">LIGMA</h1>
          <div className="who">
            {user && (
              <span className="who-display">
                {user.display} <span style={{ opacity: 0.6 }}>· {user.role}</span>
              </span>
            )}
            <button className="ligma-btn ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        <h2 className="ligma-h2">Your whiteboards</h2>

        {rooms === null && <div className="ligma-mute">Loading…</div>}

        {rooms !== null && (
          <div className="room-grid">
            <button
              className="room-card new-card"
              onClick={() => setShowNew(true)}
              aria-label="Create new whiteboard"
            >
              + New whiteboard
            </button>
            {rooms.map((r) => (
              <button
                key={r.room_id}
                className="room-card"
                onClick={() => onOpenRoom(r.room_id)}
              >
                <div className="name">{r.name}</div>
                <div className="meta">
                  <span className={`role-pill ${r.my_role ?? "Viewer"}`}>{r.my_role ?? "Viewer"}</span>
                  <span>{r.member_count} member{r.member_count === 1 ? "" : "s"}</span>
                  {r.last_at && (
                    <span>· last edit {new Date(r.last_at).toLocaleString()}</span>
                  )}
                </div>
                <div className="meta" style={{ marginTop: "auto" }}>
                  <span style={{ fontFamily: 'ui-monospace, "Menlo", monospace' }}>
                    {r.room_id}
                  </span>
                </div>
              </button>
            ))}
            {rooms.length === 0 && (
              <div className="ligma-mute" style={{ gridColumn: "1 / -1", padding: "24px 0" }}>
                You haven't joined any whiteboards yet. Create one or accept an invite.
              </div>
            )}
          </div>
        )}

        {error && <div className="error-pill" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {showNew && (
        <NewRoomModal
          busy={creating}
          onCancel={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

interface NewRoomModalProps {
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string, default_role: "Contributor" | "Viewer") => void;
}

function NewRoomModal({ busy, onCancel, onCreate }: NewRoomModalProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"Contributor" | "Viewer">("Contributor");

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New whiteboard</h3>
        <div className="ligma-mute" style={{ marginBottom: 16 }}>
          You'll be the Lead. Set the default role for invitees.
        </div>
        <input
          className="ligma-input"
          autoFocus
          placeholder="e.g. Q1 product brainstorm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onCreate(name.trim(), role);
          }}
        />
        <div className="ligma-mute" style={{ fontSize: 12, marginBottom: 6 }}>
          Default role for invite links:
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={`ligma-btn ${role === "Contributor" ? "primary" : ""}`}
            onClick={() => setRole("Contributor")}
            type="button"
            style={{ flex: 1 }}
          >
            Contributor
          </button>
          <button
            className={`ligma-btn ${role === "Viewer" ? "primary" : ""}`}
            onClick={() => setRole("Viewer")}
            type="button"
            style={{ flex: 1 }}
          >
            Viewer
          </button>
        </div>
        <div className="row">
          <button className="ligma-btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="ligma-btn primary"
            onClick={() => onCreate(name.trim(), role)}
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
