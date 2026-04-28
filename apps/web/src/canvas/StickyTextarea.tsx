import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { fromUint8Array } from "../util/b64";
import { EventKind } from "@ligma/shared";
import type { CanvasStore } from "./store";
import type { WsClient } from "../sync/ws-client";

interface Props {
  nodeId: string;
  store: CanvasStore;
  ws: WsClient;
  disabled: boolean;
}

/**
 * The textarea reads from a per-node Yjs doc (Fugue text CRDT) and writes
 * incremental Y.Text ops derived by diffing the user's edit against the
 * current doc text. This is the spec's bet #2 in action — concurrent
 * keystrokes from multiple users converge intention-preservingly because
 * each emits only the slice it actually changed, never a full replace.
 */
export function StickyTextarea({ nodeId, store, ws, disabled }: Props) {
  const doc = store.stickyText.doc(nodeId);
  const yText = doc.getText("body");
  const [text, setText] = useState(() => yText.toString());
  const ref = useRef<HTMLTextAreaElement>(null);
  // Track whether the local user is mid-composition (IME) — don't treat
  // composition events as final.
  const composingRef = useRef(false);

  // Subscribe to the doc; remote merges (or our own ack-echo) flow here.
  useEffect(() => {
    const observer = () => {
      const merged = yText.toString();
      setText((prev) => (prev === merged ? prev : merged));
    };
    yText.observe(observer);
    return () => yText.unobserve(observer);
  }, [yText]);

  function commitDiff(next: string): void {
    const before = yText.toString();
    if (before === next) return;
    // Compute a single (delete, insert) edit by finding the common prefix
    // and suffix. This is good enough for normal typing and far better than
    // wiping the doc each keystroke.
    let prefix = 0;
    const minLen = Math.min(before.length, next.length);
    while (prefix < minLen && before.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
    let suffix = 0;
    while (
      suffix < minLen - prefix &&
      before.charCodeAt(before.length - 1 - suffix) ===
        next.charCodeAt(next.length - 1 - suffix)
    )
      suffix++;
    const delLen = before.length - prefix - suffix;
    const insStr = next.slice(prefix, next.length - suffix);

    const stateBefore = Y.encodeStateVector(doc);
    doc.transact(() => {
      if (delLen > 0) yText.delete(prefix, delLen);
      if (insStr.length > 0) yText.insert(prefix, insStr);
    });
    const update = Y.encodeStateAsUpdate(doc, stateBefore);
    if (update.length === 0) return;
    ws.emitOp(EventKind.STICKY_TEXT_DELTA, nodeId, {
      yjs_update_b64: fromUint8Array(update),
    });
  }

  function onChange(ev: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = ev.target.value;
    setText(next);
    if (composingRef.current) return;
    commitDiff(next);
  }

  return (
    <textarea
      ref={ref}
      data-node-id={nodeId}
      value={text}
      onChange={onChange}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(ev) => {
        composingRef.current = false;
        commitDiff(ev.currentTarget.value);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      placeholder={disabled ? "" : "Type your idea…"}
      disabled={disabled}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        outline: "none",
        background: "transparent",
        resize: "none",
        fontFamily: "inherit",
        fontSize: 13,
        color: "#1f2937",
      }}
    />
  );
}
