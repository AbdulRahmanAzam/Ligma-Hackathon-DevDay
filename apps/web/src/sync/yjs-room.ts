import * as Y from "yjs";
import { fromUint8Array, toUint8Array } from "../util/b64";

/**
 * Per spec §5.1, sticky-note body text uses character-level Yjs Fugue. Each sticky
 * gets its own Y.Doc keyed by node id. The doc's update bytes are wrapped in a
 * STICKY_TEXT_DELTA event so they ride the same RBAC + event-log path as everything
 * else. Subscribers receive the full string after each merge.
 */
export class StickyTextRegistry {
  private docs = new Map<string, Y.Doc>();
  private listeners = new Map<string, Set<(text: string) => void>>();

  doc(nodeId: string): Y.Doc {
    let d = this.docs.get(nodeId);
    if (!d) {
      d = new Y.Doc();
      this.docs.set(nodeId, d);
    }
    return d;
  }

  text(nodeId: string): string {
    return this.doc(nodeId).getText("body").toString();
  }

  applyUpdate(nodeId: string, b64: string): void {
    const d = this.doc(nodeId);
    Y.applyUpdate(d, toUint8Array(b64));
    const text = d.getText("body").toString();
    const ls = this.listeners.get(nodeId);
    if (ls) for (const l of ls) l(text);
  }

  edit(nodeId: string, mutator: (t: Y.Text) => void): string {
    const d = this.doc(nodeId);
    const before = Y.encodeStateVector(d);
    d.transact(() => mutator(d.getText("body")));
    const update = Y.encodeStateAsUpdate(d, before);
    return fromUint8Array(update);
  }

  onChange(nodeId: string, fn: (text: string) => void): () => void {
    let s = this.listeners.get(nodeId);
    if (!s) {
      s = new Set();
      this.listeners.set(nodeId, s);
    }
    s.add(fn);
    return () => s!.delete(fn);
  }
}
