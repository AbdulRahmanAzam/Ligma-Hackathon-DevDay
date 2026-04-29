/**
 * AI Summary Export — Bonus Feature
 * Generates a structured markdown brief from canvas content.
 * Groups nodes by AI-classified intent with author/timestamp metadata.
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
// Build summary data
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

  const stats = {
    totalNodes: summaryNodes.length,
    actionItems: summaryNodes.filter((n) => n.intent === 'action').length,
    decisions: summaryNodes.filter((n) => n.intent === 'decision').length,
    questions: summaryNodes.filter((n) => n.intent === 'question').length,
    references: summaryNodes.filter((n) => n.intent === 'reference').length,
  }

  return {
    roomId: opts.roomId,
    generatedAt: new Date().toISOString(),
    nodes: summaryNodes,
    participants: opts.participants,
    stats,
  }
}

// ---------------------------------------------------------------------------
// Format as Markdown
// ---------------------------------------------------------------------------
export function formatSummaryMarkdown(data: SummaryData): string {
  const lines: string[] = []
  const date = new Date(data.generatedAt)
  const dateStr = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  lines.push(`# Brainstorm Summary — ${data.roomId}`)
  lines.push(`> Generated on ${dateStr} at ${timeStr}`)
  lines.push('')

  // Action Items
  const actions = data.nodes.filter((n) => n.intent === 'action')
  lines.push(`## 📋 Action Items (${actions.length})`)
  if (actions.length) {
    for (const node of actions) {
      lines.push(`- [ ] **${escapeMarkdown(node.text)}** — by ${node.authorName} (${node.authorRole}), ${fmtTime(node.createdAt)}`)
    }
  } else {
    lines.push('_No action items identified._')
  }
  lines.push('')

  // Decisions
  const decisions = data.nodes.filter((n) => n.intent === 'decision')
  lines.push(`## ✅ Decisions Made (${decisions.length})`)
  if (decisions.length) {
    for (const node of decisions) {
      lines.push(`- **${escapeMarkdown(node.text)}** — by ${node.authorName} (${node.authorRole}), ${fmtTime(node.createdAt)}`)
    }
  } else {
    lines.push('_No decisions recorded._')
  }
  lines.push('')

  // Questions
  const questions = data.nodes.filter((n) => n.intent === 'question')
  lines.push(`## ❓ Open Questions (${questions.length})`)
  if (questions.length) {
    for (const node of questions) {
      lines.push(`- **${escapeMarkdown(node.text)}** — by ${node.authorName} (${node.authorRole}), ${fmtTime(node.createdAt)}`)
    }
  } else {
    lines.push('_No open questions._')
  }
  lines.push('')

  // References
  const refs = data.nodes.filter((n) => n.intent === 'reference')
  lines.push(`## 📎 References (${refs.length})`)
  if (refs.length) {
    for (const node of refs) {
      lines.push(`- ${escapeMarkdown(node.text)} — ${node.authorName}, ${fmtTime(node.createdAt)}`)
    }
  } else {
    lines.push('_No references._')
  }
  lines.push('')

  // Stats
  lines.push('## 📊 Session Stats')
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Total nodes | ${data.stats.totalNodes} |`)
  lines.push(`| Action items | ${data.stats.actionItems} |`)
  lines.push(`| Decisions | ${data.stats.decisions} |`)
  lines.push(`| Open questions | ${data.stats.questions} |`)
  lines.push(`| References | ${data.stats.references} |`)
  lines.push('')

  // Participants
  lines.push('## 👥 Participants')
  if (data.participants.length) {
    for (const p of data.participants) {
      lines.push(`- **${p.name}** (${p.role})`)
    }
  } else {
    lines.push('_No active participants._')
  }
  lines.push('')
  lines.push('---')
  lines.push('*Generated by LIGMA AI Summary Export*')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/** Copy markdown text to clipboard. Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fallback below */ }

  // Legacy fallback
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Download text as a .md file. */
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
// Internals
// ---------------------------------------------------------------------------
function escapeMarkdown(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\|/g, '\\|')
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
