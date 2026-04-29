import { useEffect, useState } from "react";
import "./auth-screens.css";
import {
  createInvite,
  getRoom,
  listInvites,
  removeMember,
  revokeInvite,
  type ActiveInvite,
  type RoomMember,
} from "./auth-api";

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
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [invites, setInvites] = useState<ActiveInvite[]>([]);
  const myUserId = window.localStorage.getItem("ligma.userId");

  async function refresh() {
    try {
      const [room, list] = await Promise.all([getRoom(room_id), listInvites(room_id)]);
      setMembers(room.members ?? []);
      setOwnerId(room.owner_id);
      setInvites(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room_id]);

  async function gen() {
    setBusy(true);
    setError(null);
    try {
      const r = await createInvite(room_id, role);
      const url = `${window.location.origin}/?invite=${encodeURIComponent(r.token)}`;
      setLink(url);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        ok = true;
      }
    } catch {
      /* fall through */
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } else {
      setError("Couldn't copy. Select and copy manually.");
    }
  }

  async function copyExisting(token: string) {
    const url = `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {
      setError("Couldn't copy.");
    }
  }

  async function revoke(token: string) {
    setError(null);
    try {
      await revokeInvite(room_id, token);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function kick(user_id: string) {
    setError(null);
    try {
      await removeMember(room_id, user_id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <h3>Manage whiteboard</h3>

        {/* --- Create link --- */}
        <h4 className="ligma-h2" style={{ margin: "16px 0 8px" }}>New invite link</h4>
        <div className="ligma-mute" style={{ fontSize: 12, marginBottom: 6 }}>
          Viewers can read without signing in. Contributors must sign in.
        </div>
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

        <div className="row">
          <button className="ligma-btn primary" onClick={gen} disabled={busy}>
            {busy ? "Generating…" : "Generate link"}
          </button>
        </div>

        {link && (
          <>
            <div className="invite-link">{link}</div>
            <div className="row">
              <button className="ligma-btn primary" onClick={copy}>
                {copyState === "copied" ? "Copied" : "Copy link"}
              </button>
            </div>
          </>
        )}

        {/* --- Active links --- */}
        {invites.length > 0 && (
          <>
            <h4 className="ligma-h2" style={{ margin: "20px 0 8px" }}>Active links</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {invites.map((inv) => (
                <div key={inv.token} className="member-row">
                  <span className={`role-pill ${inv.role}`}>{inv.role}</span>
                  <span className="ligma-mute" style={{ fontSize: 11, fontFamily: 'ui-monospace, "Cascadia Mono", "Menlo", monospace' }}>
                    …{inv.token.slice(-8)}
                  </span>
                  <span className="member-tag">
                    <span className="ligma-mute" style={{ fontSize: 11 }}>
                      {inv.redeemed_count} use{inv.redeemed_count === 1 ? "" : "s"}
                    </span>
                    <button className="ligma-btn ghost" type="button" onClick={() => copyExisting(inv.token)}>Copy</button>
                    <button className="ligma-btn danger" type="button" onClick={() => revoke(inv.token)}>Revoke</button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* --- Members --- */}
        <h4 className="ligma-h2" style={{ margin: "20px 0 8px" }}>Members</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {members.map((m) => {
            const isOwner = m.user_id === ownerId;
            const isMe = m.user_id === myUserId;
            const initial = m.display?.trim().slice(0, 1).toUpperCase() || "?";
            return (
              <div key={m.user_id} className="member-row">
                <span className="member-avatar" aria-hidden="true">{initial}</span>
                <div className="member-identity">
                  <span className="member-name">
                    {m.display}
                    {isMe && (
                      <span className="ligma-mute" style={{ marginLeft: 6, fontSize: 11, fontWeight: 500 }}>
                        (you)
                      </span>
                    )}
                  </span>
                  <span className="member-email">{m.email}</span>
                </div>
                <span className="member-tag">
                  <span className={`role-pill ${m.role}`}>{m.role}</span>
                  {isOwner && (
                    <span className="ligma-mute" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                      Owner
                    </span>
                  )}
                  {!isOwner && !isMe && (
                    <button className="ligma-btn danger" type="button" onClick={() => kick(m.user_id)}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {error && <div className="error-pill" style={{ marginTop: 12 }}>{error}</div>}

        <div className="row">
          <button className="ligma-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
