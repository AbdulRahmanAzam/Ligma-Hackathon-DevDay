import { useEffect, useMemo, useRef, useState } from "react";
import { type BaseEvent, type Role, type TaskRow } from "@ligma/shared";
import { Login } from "./auth/Login";
import { CanvasStore } from "./canvas/store";
import { Canvas } from "./canvas/Canvas";
import { TaskBoard } from "./task-board/TaskBoard";
import { WsClient } from "./sync/ws-client";
import { IntentPipeline } from "./ai/intent-pipeline";
import { warmModel } from "./ai/classifier";
import { Scrubber } from "./timetravel/Scrubber";

const ROOM = new URL(window.location.href).searchParams.get("room") ?? "rm_demo";

interface Auth {
  token: string;
  user: { user_id: string; display: string; email: string };
}

export function App() {
  const [auth, setAuth] = useState<Auth | null>(null);

  if (!auth) {
    return <Login onAuth={(token, user) => setAuth({ token, user })} />;
  }

  return <Workspace auth={auth} room={ROOM} onSignOut={() => {
    localStorage.removeItem("ligma.token");
    localStorage.removeItem("ligma.user");
    setAuth(null);
  }} />;
}

interface WorkspaceProps {
  auth: Auth;
  room: string;
  onSignOut: () => void;
}

function Workspace({ auth, room, onSignOut }: WorkspaceProps) {
  const store = useMemo(() => new CanvasStore(), []);
  const [role, setRole] = useState<Role>("viewer");
  const [tasks, setTasks] = useState<Map<string, TaskRow>>(new Map());
  const [remoteCursors, setRemoteCursors] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const [conn, setConn] = useState<"connecting" | "open" | "closed">("connecting");
  const [selected, setSelected] = useState<string | null>(null);
  const [liveSeq, setLiveSeq] = useState(0);
  const [isReplay, setIsReplay] = useState(false);
  const [modelStatus, setModelStatus] = useState<string>("idle");
  const eventsRef = useRef<BaseEvent[]>([]);
  const wsRef = useRef<WsClient | null>(null);

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  useEffect(() => {
    const ws = new WsClient(wsUrl, auth.token, room, {
      onConnectionState: (s) => setConn(s),
      onHello: (r) => setRole(r),
      onAck: () => {
        /* The op event is also broadcast back; we apply on onEvent. */
      },
      onEvent: (e) => {
        if (!isReplay) {
          store.applyEvent(e);
          eventsRef.current.push(e);
          setLiveSeq((s) => Math.max(s, e.seq));
        } else {
          // Buffer events while replaying; we'll fold them in on return-to-live.
          eventsRef.current.push(e);
          setLiveSeq((s) => Math.max(s, e.seq));
        }
      },
      onPresence: (uid, cursor) => {
        if (uid === auth.user.user_id) return;
        setRemoteCursors((prev) => {
          const next = new Map(prev);
          next.set(uid, cursor);
          return next;
        });
      },
      onRoleChanged: (uid, _node, newRole) => {
        if (uid === auth.user.user_id) setRole(newRole);
      },
      onRbacDenied: (_id, reason, kind) => {
        window.dispatchEvent(
          new CustomEvent("ligma-rbac-denied", { detail: `${kind}: ${reason}` }),
        );
      },
      onTaskUpserted: (task) => {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(task.task_id, task);
          return next;
        });
      },
    });
    wsRef.current = ws;
    ws.start();

    // Warm the ONNX model in the background.
    warmModel();
    setModelStatus("loading");

    const onReady = () => setModelStatus("ready");
    const onProgress = (e: Event) => {
      const ce = e as CustomEvent<{ progress: number; file: string }>;
      setModelStatus(`loading ${ce.detail.file ?? ""} ${(ce.detail.progress ?? 0).toFixed(0)}%`);
    };
    window.addEventListener("ligma-model-ready", onReady);
    window.addEventListener("ligma-model-load", onProgress);

    const pipeline = new IntentPipeline(store, ws);
    const stopPipeline = pipeline.start();

    return () => {
      stopPipeline();
      ws.stop();
      window.removeEventListener("ligma-model-ready", onReady);
      window.removeEventListener("ligma-model-load", onProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, room, wsUrl, store]);

  // When return-to-live happens, replay buffered events into the store.
  useEffect(() => {
    if (!isReplay) {
      // re-apply the full event log after a scrub.
      store.clear();
      for (const e of eventsRef.current) store.applyEvent(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay]);

  function onJumpToTask(sourceNode: string) {
    setSelected(sourceNode);
    const node = store.snapshot().nodes.get(sourceNode);
    if (!node) return;
    // simple approach: nothing to scroll since the canvas is fixed; selection ring is the cue.
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>LIGMA</h1>
        <span className="pill">room {room}</span>
        <span className={`pill role-${role}`}>{role}</span>
        <span className="pill">
          {conn === "open" ? "✓ connected" : conn === "connecting" ? "… connecting" : "× offline"}
        </span>
        <span className="pill">model: {modelStatus}</span>
        <span className="pill">seq {liveSeq}</span>
        <span className="actor-switch">
          <span style={{ fontSize: 12, color: "var(--ligma-fg-mute)", padding: "6px 8px" }}>
            {auth.user.display}
          </span>
          <button onClick={onSignOut}>Switch user</button>
        </span>
      </div>

      <Canvas
        store={store}
        ws={wsRef.current!}
        role={role}
        selfUserId={auth.user.user_id}
        remoteCursors={remoteCursors}
        onSelectNode={setSelected}
        selectedNode={selected}
        isReplay={isReplay}
      />

      <TaskBoard tasks={tasks} onJump={onJumpToTask} />

      <Scrubber
        liveSeq={liveSeq}
        events={eventsRef.current}
        store={store}
        isReplay={isReplay}
        setIsReplay={setIsReplay}
      />
    </div>
  );
}
