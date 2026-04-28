import { useEffect, useState } from "react";
import type { BaseEvent } from "@ligma/shared";
import type { CanvasStore } from "../canvas/store";

interface Props {
  liveSeq: number;
  events: BaseEvent[]; // full sequence in order; reset on refresh
  store: CanvasStore;
  isReplay: boolean;
  setIsReplay: (b: boolean) => void;
}

/**
 * Per spec §10. Same code path as boot/reconnect — we walk events from 0 to
 * the target seq and apply them to a fresh store. While scrubbing, the canvas
 * is read-only (the parent passes isReplay to disable mutations).
 *
 * Forward scrub: fold the next slice of events into the current state — cheap.
 * Backward scrub: rebuild from the first event (no snapshot blob needed at this
 * scale; the spec says "snapshots cap backwards-jump cost" but for hackathon
 * sessions of <3000 events we just rebuild from 0 — sub-50ms).
 */
export function Scrubber({ liveSeq, events, store, isReplay, setIsReplay }: Props) {
  const [target, setTarget] = useState(liveSeq);

  useEffect(() => {
    if (!isReplay) setTarget(liveSeq);
  }, [liveSeq, isReplay]);

  function rebuild(toSeq: number): void {
    store.clear();
    for (const e of events) {
      if (e.seq > toSeq) break;
      store.applyEvent(e);
    }
  }

  function onScrubChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(ev.target.value);
    setTarget(next);
    if (!isReplay) setIsReplay(true);
    rebuild(next);
  }

  function returnLive() {
    setIsReplay(false);
    setTarget(liveSeq);
    rebuild(liveSeq);
  }

  return (
    <div className="scrubber">
      <span className={`live-pill ${isReplay ? "replay" : ""}`}>
        {isReplay ? "REPLAY" : "LIVE"}
      </span>
      <span style={{ minWidth: 60 }}>
        seq <strong>{isReplay ? target : liveSeq}</strong> / {liveSeq}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(0, liveSeq)}
        step={1}
        value={isReplay ? target : liveSeq}
        onChange={onScrubChange}
      />
      <button onClick={returnLive} disabled={!isReplay}>
        Return to live
      </button>
    </div>
  );
}
