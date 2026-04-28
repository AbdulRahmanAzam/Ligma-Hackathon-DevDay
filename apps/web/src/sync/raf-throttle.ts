/**
 * Coalesces many calls within an animation frame down to a single invocation
 * with the latest argument. Used for drag/resize so we emit at most one
 * NODE_MOVED / NODE_RESIZED per frame (~60Hz) instead of one per mousemove
 * (which can fire 100+ Hz on high-rate trackpads).
 */
export function rafThrottle<T>(fn: (arg: T) => void): {
  call: (arg: T) => void;
  flush: () => void;
} {
  let pending: { value: T } | null = null;
  let scheduled = false;

  function tick(): void {
    scheduled = false;
    if (pending) {
      const v = pending.value;
      pending = null;
      fn(v);
    }
  }

  return {
    call(arg: T) {
      pending = { value: arg };
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(tick);
      }
    },
    flush() {
      if (pending) {
        const v = pending.value;
        pending = null;
        fn(v);
      }
    },
  };
}
