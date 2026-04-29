import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { Login } from "./Login";
import { Home } from "./Home";
import { acceptInvite, readInvite, readToken, type InviteInfo } from "./auth-api";

// Polyfill crypto.randomUUID for non-secure contexts (Safari over plain HTTP,
// older browsers). Patches the global so tldraw + any other dep that calls it
// gets a working impl. Must run before App imports tldraw.
(function patchRandomUUID() {
  const c = (globalThis as { crypto?: Crypto & { randomUUID?: () => string } }).crypto;
  if (!c) return;
  if (typeof c.randomUUID === "function") {
    try {
      c.randomUUID();
      return;
    } catch {
      /* fall through */
    }
  }
  Object.defineProperty(c, "randomUUID", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function (): string {
      const bytes = new Uint8Array(16);
      if (typeof c.getRandomValues === "function") {
        c.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex: string[] = [];
      for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    },
  });
})();

// Tiny URL helpers (no router lib).
function getSearch(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function setRoomInUrl(room_id: string | null): void {
  const url = new URL(window.location.href);
  if (room_id) url.searchParams.set("room", room_id);
  else url.searchParams.delete("room");
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.toString());
}

type View =
  | { kind: "home" }
  | { kind: "room"; room_id: string; guestInvite?: string }
  | { kind: "invite-pending"; token: string; info: InviteInfo | null; error: string | null };

function Root() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(readToken()));
  const [view, setView] = useState<View>(() => initialView());
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Bumping this re-runs the invite lookup (used by the retry button so a
  // transient network error doesn't leave the visitor stuck).
  const [inviteAttempt, setInviteAttempt] = useState(0);

  // Resolve invite metadata. We do this in an effect (not in the useState
  // initializer) so a fetch failure can be surfaced via state instead of
  // silently swallowed, and so retry works without remounting the page.
  useEffect(() => {
    if (view.kind !== "invite-pending") return;
    if (view.info) return;
    let cancelled = false;
    readInvite(view.token)
      .then((info) => {
        if (cancelled) return;
        setView((prev) =>
          prev.kind === "invite-pending" && prev.token === view.token
            ? { ...prev, info, error: null }
            : prev,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setView((prev) =>
          prev.kind === "invite-pending" && prev.token === view.token
            ? { ...prev, error: message }
            : prev,
        );
      });
    return () => {
      cancelled = true;
    };
    // inviteAttempt is read so the retry button can re-trigger the fetch.
  }, [view, inviteAttempt]);

  // Anonymous Viewer fast-path: if the invite is read-only, drop the visitor
  // straight into the room as a guest — no signup required. Also persist the
  // room_id into the URL (and clear ?invite=) so a reload lands them in the
  // same room instead of bouncing through the invite resolver again.
  useEffect(() => {
    if (authed) return;
    if (view.kind !== "invite-pending") return;
    if (!view.info) return;
    if (view.info.role !== "Viewer") return;
    const room_id = view.info.room_id;
    const token = view.token;
    setRoomInUrl(room_id);
    setView({ kind: "room", room_id, guestInvite: token });
  }, [authed, view]);

  // After auth state changes, re-derive view (so post-login we honor ?invite= or ?room=).
  useEffect(() => {
    if (!authed) return;
    const v = initialView();
    setView(v);
  }, [authed]);

  // If the view is invite-pending and we're authed, claim the invite.
  useEffect(() => {
    if (!authed) return;
    if (view.kind !== "invite-pending") return;
    let cancelled = false;
    acceptInvite(view.token)
      .then((r) => {
        if (cancelled) return;
        setAcceptError(null);
        setRoomInUrl(r.room_id);
        setView({ kind: "room", room_id: r.room_id });
      })
      .catch((err) => {
        if (cancelled) return;
        setAcceptError(err instanceof Error ? err.message : String(err));
        // Drop user on the home page so they're not stuck.
        setRoomInUrl(null);
        setView({ kind: "home" });
      });
    return () => {
      cancelled = true;
    };
  }, [authed, view]);

  // Cross-tab session changes (e.g., other tab signed out).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ligma.token") {
        setAuthed(Boolean(e.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Anonymous viewer in a guest room — render App without auth.
  if (!authed && view.kind === "room" && view.guestInvite) {
    return (
      <App
        key={view.room_id}
        guestInviteToken={view.guestInvite}
        onBackToHome={() => {
          window.location.href = "/";
        }}
        roomError={null}
        clearRoomError={() => {}}
      />
    );
  }

  if (!authed) {
    // Invite-pending without info yet: show a loader (or an error with retry)
    // instead of the sign-in screen. An anonymous Viewer should never see the
    // Login form — they'd have no way to know the link was a Viewer invite,
    // and a Viewer fast-path is queued as soon as info resolves.
    if (view.kind === "invite-pending" && !view.info) {
      if (view.error) {
        return (
          <InviteErrorScreen
            message={view.error}
            onRetry={() => {
              setView((prev) =>
                prev.kind === "invite-pending"
                  ? { ...prev, error: null }
                  : prev,
              );
              setInviteAttempt((n) => n + 1);
            }}
            onSignIn={() => {
              // Let the user fall back to the sign-in screen if the invite
              // really is dead (revoked/expired). They can sign in and use
              // the home page instead of being stuck.
              setRoomInUrl(null);
              setView({ kind: "home" });
            }}
          />
        );
      }
      return <LoadingScreen label="Joining whiteboard…" />;
    }

    // Contributor invite (info loaded): show Login pre-tabbed to Sign up,
    // with the room name as a hint.
    let inviteRoomName: string | undefined;
    if (view.kind === "invite-pending" && view.info) {
      inviteRoomName = view.info.room_name;
    }
    return (
      <Login
        onAuth={() => setAuthed(true)}
        defaultTab={view.kind === "invite-pending" ? "signup" : "signin"}
        inviteRoomName={inviteRoomName}
      />
    );
  }

  if (view.kind === "home") {
    return (
      <Home
        onOpenRoom={(room_id) => {
          setRoomInUrl(room_id);
          setView({ kind: "room", room_id });
        }}
        onSignOut={() => {
          setAuthed(false);
          setRoomInUrl(null);
          setView({ kind: "home" });
        }}
      />
    );
  }

  if (view.kind === "room") {
    // Force a fresh App mount per-room so its useState(readSearchRoomId)
    // re-reads the URL and roomId tracks the actual current room.
    return (
      <App
        key={view.room_id}
        onBackToHome={() => {
          setRoomInUrl(null);
          setView({ kind: "home" });
        }}
        roomError={acceptError}
        clearRoomError={() => setAcceptError(null)}
      />
    );
  }

  // invite-pending while we wait for the accept fetch
  return <LoadingScreen label="Joining whiteboard…" />;
}

const SCREEN_BASE_STYLE = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#f8fafc",
  color: "#475569",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Inter, sans-serif",
} as const;

function LoadingScreen({ label }: { label: string }) {
  return <div style={SCREEN_BASE_STYLE}>{label}</div>;
}

function InviteErrorScreen({
  message,
  onRetry,
  onSignIn,
}: {
  message: string;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  // Surface the underlying server error so a revoked/expired invite is
  // distinguishable from a transient network failure. Both retry and
  // sign-in are offered so the visitor is never stranded.
  const expiredOrRevoked = /expired|revoked|not_found/i.test(message);
  return (
    <div style={SCREEN_BASE_STYLE}>
      <div
        style={{
          maxWidth: 420,
          padding: 28,
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: "0 0 8px", color: "#0f172a", fontSize: 18 }}>
          We couldn't open this invite
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 14 }}>
          {expiredOrRevoked
            ? "This invite link is no longer valid. Ask the room lead for a fresh link."
            : `Something went wrong while loading the invite${message ? ` (${message})` : ""}. Check your connection and try again.`}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {!expiredOrRevoked && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #0ea5e9",
                background: "#0ea5e9",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={onSignIn}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5f5",
              background: "#fff",
              color: "#0f172a",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Continue to sign in
          </button>
        </div>
      </div>
    </div>
  );
}

function initialView(): View {
  const params = getSearch();
  const invite = params.get("invite");
  if (invite) {
    return { kind: "invite-pending", token: invite, info: null, error: null };
  }
  const room = params.get("room");
  if (room) return { kind: "room", room_id: room };
  return { kind: "home" };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
