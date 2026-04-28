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
  | { kind: "room"; room_id: string }
  | { kind: "invite-pending"; token: string; info: InviteInfo | null; error: string | null };

function Root() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(readToken()));
  const [view, setView] = useState<View>(() => initialView());
  const [acceptError, setAcceptError] = useState<string | null>(null);

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

  if (!authed) {
    // If they're hitting an invite link unauthenticated, show login with a hint.
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
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0c111c",
        color: "#94a3b8",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Inter, sans-serif",
      }}
    >
      Joining whiteboard…
    </div>
  );
}

function initialView(): View {
  const params = getSearch();
  const invite = params.get("invite");
  if (invite) {
    // Kick off a non-auth invite preview so we can show the room name on Login.
    const v: View = { kind: "invite-pending", token: invite, info: null, error: null };
    readInvite(invite)
      .then((info) => {
        // we update the state via a custom event because we're outside the component
        window.dispatchEvent(new CustomEvent("ligma-invite-info", { detail: info }));
      })
      .catch(() => {
        /* ignore — server will tell us on accept */
      });
    return v;
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
