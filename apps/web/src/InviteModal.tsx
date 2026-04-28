import { useState } from "react";
import "./auth-screens.css";
import { createInvite } from "./auth-api";

interface Props {
  room_id: string;
  onClose: () => void;
}

export function InviteModal({ room_id, onClose }: Props) {
  const [role, setRole] = useState<"Contributor" | "Viewer">("Contributor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  async function gen() {
    setBusy(true);
    setError(null);
    try {
      const r = await createInvite(room_id, role);
      const url = `${window.location.origin}/?invite=${encodeURIComponent(r.token)}`;
      setLink(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setError("Couldn't copy. Select and copy manually.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Invite to whiteboard</h3>
        <div className="ligma-mute" style={{ marginBottom: 14 }}>
          Anyone with the link who's signed in joins as the role you pick.
        </div>
        <div className="ligma-mute" style={{ fontSize: 12, marginBottom: 6 }}>Role for new members:</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={`ligma-btn ${role === "Contributor" ? "primary" : ""}`}
            onClick={() => setRole("Contributor")}
            type="button"
            style={{ flex: 1 }}
            disabled={busy}
          >
            Contributor
          </button>
          <button
            className={`ligma-btn ${role === "Viewer" ? "primary" : ""}`}
            onClick={() => setRole("Viewer")}
            type="button"
            style={{ flex: 1 }}
            disabled={busy}
          >
            Viewer
          </button>
        </div>

        {!link && (
          <div className="row">
            <button className="ligma-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="ligma-btn primary" onClick={gen} disabled={busy}>
              {busy ? "Generating…" : "Generate link"}
            </button>
          </div>
        )}

        {link && (
          <>
            <div className="ligma-mute" style={{ fontSize: 12, marginTop: 14 }}>
              Share this link (expires in 7 days):
            </div>
            <div className="invite-link">{link}</div>
            <div className="row">
              <button className="ligma-btn ghost" onClick={onClose}>Close</button>
              <button className="ligma-btn primary" onClick={copy}>
                {copyState === "copied" ? "Copied" : "Copy link"}
              </button>
            </div>
          </>
        )}

        {error && <div className="error-pill">{error}</div>}
      </div>
    </div>
  );
}
