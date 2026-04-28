import { useState } from "react";
import type { CanvasStore } from "../canvas/store";
import { downloadMarkdown, generateBrief } from "./brief";

interface Props {
  store: CanvasStore;
  roomName: string;
}

export function ExportBriefButton({ store, roomName }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  async function exportBrief() {
    if (busy) return;
    setBusy(true);
    setProgress("Loading summarizer (first run downloads ~280MB)...");
    try {
      const md = await generateBrief({
        roomName,
        store,
        onProgress: (msg) => setProgress(msg),
      });
      const safe = roomName.replace(/[^a-z0-9-_]/gi, "_").slice(0, 40) || "ligma";
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      downloadMarkdown(`${safe}-brief-${stamp}.md`, md);
      setProgress("Downloaded.");
      window.setTimeout(() => setProgress(""), 2000);
    } catch (err) {
      console.error("[brief] export failed", err);
      setProgress("Failed — see console");
      window.setTimeout(() => setProgress(""), 3000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="export-brief-btn"
      onClick={exportBrief}
      disabled={busy}
      title="Generate a structured markdown brief of this room"
    >
      {busy ? (progress || "Working…") : "📄 Export brief"}
    </button>
  );
}
