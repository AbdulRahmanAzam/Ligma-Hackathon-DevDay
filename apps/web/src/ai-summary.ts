/**
 * AI Summary Export — Premium Edition
 * - LLM-powered summary via DigitalOcean GenAI API (server proxy)
 * - Beautiful HTML report with premium cream/gold styling
 * - PDF export via browser print
 * - Canvas snapshot embedding
 */
import type { IntentLabel, IntentResult } from './ai-intent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SummaryNode {
  id: string
  text: string
  intent: IntentLabel 
  score: number
  source: 'ai' | 'regex'
  authorName: string
  authorRole: string
  createdAt: string
}

export interface SummaryData {
  roomId: string
  generatedAt: string
  nodes: SummaryNode[]
  participants: Array<{ name: string; role: string; color: string }>
  stats: {
    totalNodes: number
    actionItems: number
    decisions: number
    questions: number
    references: number
  }
}

// ---------------------------------------------------------------------------
// Build summary data from canvas nodes
// ---------------------------------------------------------------------------
export function buildSummaryData(opts: {
  roomId: string
  nodes: Array<{
    id: string
    text: string
    intentResult: IntentResult
    authorName: string
    authorRole: string
    createdAt: string
  }>
  participants: Array<{ name: string; role: string; color: string }>
}): SummaryData {
  const summaryNodes: SummaryNode[] = opts.nodes.map((n) => ({
    id: n.id,
    text: n.text,
    intent: n.intentResult.intent,
    score: n.intentResult.score,
    source: n.intentResult.source,
    authorName: n.authorName,
    authorRole: n.authorRole,
    createdAt: n.createdAt,
  }))

  return {
    roomId: opts.roomId,
    generatedAt: new Date().toISOString(),
    nodes: summaryNodes,
    participants: opts.participants,
    stats: {
      totalNodes: summaryNodes.length,
      actionItems: summaryNodes.filter((n) => n.intent === 'action').length,
      decisions: summaryNodes.filter((n) => n.intent === 'decision').length,
      questions: summaryNodes.filter((n) => n.intent === 'question').length,
      references: summaryNodes.filter((n) => n.intent === 'reference').length,
    },
  }
}

// ---------------------------------------------------------------------------
// LLM-powered summary via server proxy
// ---------------------------------------------------------------------------
export async function fetchLLMSummary(
  data: SummaryData,
): Promise<{ summary: string; source: 'llm' } | { summary: null; source: 'fallback'; error: string }> {
  const token = window.localStorage.getItem('ligma.token')
  if (!token) return { summary: null, source: 'fallback', error: 'Not authenticated' }

  try {
    const res = await fetch('/api/ai/summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        roomId: data.roomId,
        nodes: data.nodes.map((n) => ({
          text: n.text,
          intent: n.intent,
          authorName: n.authorName,
          authorRole: n.authorRole,
          createdAt: fmtTime(n.createdAt),
        })),
        participants: data.participants.map((p) => ({ name: p.name, role: p.role })),
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'unknown' }))
      return { summary: null, source: 'fallback', error: (err as { error?: string }).error ?? 'API error' }
    }

    const json = (await res.json()) as { summary?: string }
    if (json.summary) {
      return { summary: json.summary, source: 'llm' }
    }
    return { summary: null, source: 'fallback', error: 'Empty LLM response' }
  } catch (err) {
    return { summary: null, source: 'fallback', error: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Local fallback markdown formatter
// ---------------------------------------------------------------------------
export function formatSummaryMarkdown(data: SummaryData): string {
  const lines: string[] = []
  const dateStr = fmtDate(data.generatedAt)
  const timeStr = fmtTime(data.generatedAt)

  lines.push(`# Brainstorm Summary — ${data.roomId}`)
  lines.push(`> Generated on ${dateStr} at ${timeStr}`)
  lines.push('')

  lines.push(`## Executive Summary`)
  lines.push(
    `A brainstorming session with ${data.participants.length} participant(s) produced ${data.stats.totalNodes} classified nodes: ${data.stats.actionItems} action item(s), ${data.stats.decisions} decision(s), ${data.stats.questions} open question(s), and ${data.stats.references} reference(s).`,
  )
  lines.push('')

  const actions = data.nodes.filter((n) => n.intent === 'action')
  lines.push(`## 📋 Action Items (${actions.length})`)
  if (actions.length) {
    for (const n of actions)
      lines.push(
        `- [ ] **${esc(n.text)}** — ${n.authorName} (${n.authorRole}), ${fmtTime(n.createdAt)}`,
      )
  } else lines.push('_No action items identified._')
  lines.push('')

  const decisions = data.nodes.filter((n) => n.intent === 'decision')
  lines.push(`## ✅ Key Decisions (${decisions.length})`)
  if (decisions.length) {
    for (const n of decisions)
      lines.push(`- **${esc(n.text)}** — ${n.authorName}, ${fmtTime(n.createdAt)}`)
  } else lines.push('_No decisions recorded._')
  lines.push('')

  const questions = data.nodes.filter((n) => n.intent === 'question')
  lines.push(`## ❓ Open Questions (${questions.length})`)
  if (questions.length) {
    for (const n of questions)
      lines.push(`- **${esc(n.text)}** — ${n.authorName}, ${fmtTime(n.createdAt)}`)
  } else lines.push('_No open questions._')
  lines.push('')

  const refs = data.nodes.filter((n) => n.intent === 'reference')
  lines.push(`## 📎 References (${refs.length})`)
  if (refs.length) {
    for (const n of refs) lines.push(`- ${esc(n.text)} — ${n.authorName}`)
  } else lines.push('_No references._')
  lines.push('')

  lines.push('## 📊 Session Analytics')
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Total nodes | ${data.stats.totalNodes} |`)
  lines.push(`| Action items | ${data.stats.actionItems} |`)
  lines.push(`| Decisions | ${data.stats.decisions} |`)
  lines.push(`| Questions | ${data.stats.questions} |`)
  lines.push(`| References | ${data.stats.references} |`)
  lines.push('')

  lines.push('## 👥 Participants')
  for (const p of data.participants) lines.push(`- **${p.name}** (${p.role})`)
  lines.push('')
  lines.push('---')
  lines.push('*Generated by LIGMA AI Summary Export*')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Premium HTML report for PDF export
// ---------------------------------------------------------------------------
export function buildPremiumHTML(
  markdownContent: string,
  data: SummaryData,
  snapshotDataUrl: string | null,
  llmSource: boolean,
): string {
  const dateStr = fmtDate(data.generatedAt)
  const timeStr = fmtTime(data.generatedAt)

  // Convert markdown to simple HTML
  const bodyHTML = markdownToHTML(markdownContent)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LIGMA Summary — ${escHTML(data.roomId)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(180deg, #FFFDF5 0%, #FFF9E6 40%, #FFF7DB 100%);
    color: #2D2A1E;
    line-height: 1.65;
    min-height: 100vh;
    padding: 0;
  }

  .report-page {
    max-width: 780px;
    margin: 0 auto;
    padding: 48px 40px 60px;
  }

  /* Header */
  .report-header {
    text-align: center;
    padding-bottom: 36px;
    border-bottom: 2px solid #E8DFC4;
    margin-bottom: 36px;
  }

  .report-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px; height: 56px;
    background: #1A1A14;
    color: #F7CB45;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 32px;
    font-weight: 700;
    border-radius: 14px;
    margin-bottom: 16px;
  }

  .report-header h1 {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 28px;
    font-weight: 700;
    color: #1A1A14;
    margin-bottom: 4px;
  }

  .report-header .subtitle {
    font-size: 14px;
    color: #7A7360;
    font-weight: 500;
  }

  .report-header .meta-row {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin-top: 14px;
    font-size: 12px;
    color: #8B8270;
  }

  .meta-row .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .badge-ai {
    background: linear-gradient(135deg, #E8F5E9, #C8E6C9);
    color: #1B5E20;
    border: 1px solid #A5D6A7;
  }

  .badge-local {
    background: #FFF3E0;
    color: #E65100;
    border: 1px solid #FFCC80;
  }

  /* Content body */
  .report-body h2 {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 20px;
    font-weight: 700;
    color: #1A1A14;
    margin: 32px 0 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid #E8DFC4;
  }

  .report-body p { margin-bottom: 12px; font-size: 14px; }

  .report-body ul, .report-body ol {
    padding-left: 20px;
    margin-bottom: 14px;
  }

  .report-body li {
    margin-bottom: 6px;
    font-size: 14px;
    line-height: 1.6;
  }

  .report-body strong { color: #1A1A14; }

  .report-body blockquote {
    padding: 12px 18px;
    margin: 12px 0;
    border-left: 4px solid #DAA520;
    background: rgba(218,165,32,0.06);
    border-radius: 0 8px 8px 0;
    font-style: italic;
    color: #5C5640;
    font-size: 14px;
  }

  .report-body table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 13px;
  }

  .report-body th, .report-body td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid #E8DFC4;
  }

  .report-body th {
    background: rgba(218,165,32,0.08);
    font-weight: 700;
    color: #5C4A1E;
  }

  .report-body em { color: #7A7360; }

  /* Snapshot */
  .snapshot-section {
    margin-top: 40px;
    padding-top: 28px;
    border-top: 2px solid #E8DFC4;
  }

  .snapshot-section h2 {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 20px;
    margin-bottom: 16px;
    color: #1A1A14;
  }

  .snapshot-img {
    width: 100%;
    border: 1px solid #E0D8C0;
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(60,50,30,0.1);
  }

  /* Footer */
  .report-footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid #E8DFC4;
    text-align: center;
    font-size: 11px;
    color: #A09880;
  }

  /* Toolbar for PDF actions */
  .toolbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 12px;
    background: rgba(26,26,20,0.95);
    backdrop-filter: blur(10px);
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  }

  .toolbar button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 8px;
    background: rgba(255,255,255,0.1);
    color: #F7CB45;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }

  .toolbar button:hover { background: rgba(255,255,255,0.2); }

  .toolbar .brand { color: #F7CB45; font-weight: 800; font-size: 14px; margin-right: 12px; }

  @media print {
    .toolbar { display: none !important; }
    body { background: #FFFDF5 !important; }
    .report-page { padding: 24px 20px !important; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="brand">LIGMA</span>
    <button onclick="window.print()">📄 Save as PDF</button>
    <button onclick="window.close()">✕ Close</button>
  </div>

  <div class="report-page" style="margin-top: 60px;">
    <div class="report-header">
      <div class="report-logo">L</div>
      <h1>Brainstorm Summary</h1>
      <p class="subtitle">${escHTML(data.roomId)}</p>
      <div class="meta-row">
        <span>${dateStr} at ${timeStr}</span>
        <span>${data.participants.length} participant(s)</span>
        <span>${data.stats.totalNodes} nodes classified</span>
        <span class="badge ${llmSource ? 'badge-ai' : 'badge-local'}">
          ${llmSource ? '🧠 AI-Generated' : '⚙ Local Classification'}
        </span>
      </div>
    </div>

    <div class="report-body">
      ${bodyHTML}
    </div>

    ${
      snapshotDataUrl
        ? `<div class="snapshot-section">
        <h2>📸 Canvas Snapshot</h2>
        <img class="snapshot-img" src="${snapshotDataUrl}" alt="Canvas snapshot at time of export" />
      </div>`
        : ''
    }

    <div class="report-footer">
      Generated by LIGMA AI Summary Export &middot; ${dateStr}
    </div>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Canvas snapshot capture
// ---------------------------------------------------------------------------
export async function captureCanvasSnapshot(): Promise<string | null> {
  try {
    // Approach 1: Find tldraw's rendered SVG container
    const svgEl = document.querySelector('.tl-svg-context') as SVGSVGElement | null
    if (svgEl) {
      const clone = svgEl.cloneNode(true) as SVGSVGElement
      // Set explicit dimensions
      const bbox = svgEl.getBoundingClientRect()
      clone.setAttribute('width', String(Math.round(bbox.width)))
      clone.setAttribute('height', String(Math.round(bbox.height)))
      const serializer = new XMLSerializer()
      const svgString = serializer.serializeToString(clone)
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`
    }

    // Approach 2: Find any canvas element inside tldraw
    const canvasEl = document.querySelector('.tl-container canvas') as HTMLCanvasElement | null
    if (canvasEl) {
      return canvasEl.toDataURL('image/png')
    }
  } catch {
    /* graceful fallback */
  }
  return null
}

// ---------------------------------------------------------------------------
// Open premium PDF-ready report in new window
// ---------------------------------------------------------------------------
export function openPDFReport(html: string): void {
  const win = window.open('', '_blank')
  if (!win) {
    // Popup blocked — fallback to blob download
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ligma-summary.html'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return
  }
  win.document.write(html)
  win.document.close()
}

// ---------------------------------------------------------------------------
// Clipboard & download helpers
// ---------------------------------------------------------------------------
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function downloadMarkdown(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Markdown → HTML converter (simple, no dependencies)
// ---------------------------------------------------------------------------
function markdownToHTML(md: string): string {
  let html = escHTML(md)

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // Tables
  html = html.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm,
    (_match, headerRow: string, _sep: string, bodyRows: string) => {
      const headers = headerRow
        .split('|')
        .filter((c: string) => c.trim())
        .map((c: string) => `<th>${c.trim()}</th>`)
        .join('')
      const rows = bodyRows
        .trim()
        .split('\n')
        .map((row: string) => {
          const cells = row
            .split('|')
            .filter((c: string) => c.trim())
            .map((c: string) => `<td>${c.trim()}</td>`)
            .join('')
          return `<tr>${cells}</tr>`
        })
        .join('')
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`
    },
  )

  // Checkbox list items
  html = html.replace(/^- \[ \]\s+(.+)$/gm, '<li style="list-style:none">☐ $1</li>')
  html = html.replace(/^- \[x\]\s+(.+)$/gm, '<li style="list-style:none">☑ $1</li>')

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Numbered list items
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #E8DFC4;margin:28px 0">')

  // Paragraphs: wrap remaining lone lines
  html = html
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (
        !trimmed ||
        trimmed.startsWith('<h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('<li') ||
        trimmed.startsWith('<table') ||
        trimmed.startsWith('<thead') ||
        trimmed.startsWith('<tbody') ||
        trimmed.startsWith('<tr') ||
        trimmed.startsWith('<th') ||
        trimmed.startsWith('<td') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('</') ||
        trimmed.startsWith('<div') ||
        trimmed.startsWith('<img')
      )
        return line
      return `<p>${line}</p>`
    })
    .join('\n')

  return html
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\|/g, '\\|')
}

function escHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
