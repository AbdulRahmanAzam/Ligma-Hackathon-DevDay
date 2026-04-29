import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Tldraw,
  createShapeId,
  createTLUser,
  defaultUserPreferences,
  renderPlaintextFromRichText,
  toRichText,
  useAtom,
  type Editor,
  type TLGeoShape,
  type TLNoteShape,
  type TLShape,
  type TLShapeId,
  type TLTextShape,
  type TLRichText,
  type TLUserPreferences,
} from 'tldraw'
import * as Y from 'yjs'
import {
  Activity,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardList,
  Copy,
  Diamond,
  Download,
  Eye,
  FileText,
  Gauge,
  Hand,
  Link2,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  MousePointer2,
  Pause,
  PenLine,
  Play,
  ShieldAlert,
  Share2,
  Sparkles,
  Square,
  StickyNote,
  TimerReset,
  Type,
  UnlockKeyhole,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import 'tldraw/tldraw.css'
import './App.css'
import { InviteModal } from './InviteModal'
import { requestAiSummary } from './auth-api'
import {
  classifyIntentAI,
  classifyIntentRegex,
  clearIntentCache,
  isModelReady,
  preloadModel,
  type IntentResult,
} from './ai-intent'
import {
  buildSummaryData,
  copyToClipboard,
  downloadMarkdown,
  formatSummaryMarkdown,
} from './ai-summary'

type UserRole = 'Lead' | 'Contributor' | 'Viewer'
type Intent = 'action' | 'decision' | 'question' | 'reference'
type ConnectionStatus = 'connecting' | 'online' | 'offline'

type LigmaNodeMeta = {
  authorColorIndex: number
  authorId: string
  authorName: string
  authorRole: UserRole
  createdAt: string
  lockedToRoles: UserRole[]
}

type CanvasStats = {
  actionCount: number
  decisionCount: number
  eventCount: number
  nodeCount: number
  questionCount: number
  selectedNodeIds: TLShapeId[]
}

type CanvasTask = {
  authorColorIndex: number
  authorName: string
  authorRole: UserRole
  createdAt: string
  intent: 'action'
  nodeId: TLShapeId
  title: string
}

type CanvasIntentBadge = {
  intent: Intent
  label: string
  nodeId: TLShapeId
  x: number
  y: number
}

type CanvasLockBadge = {
  label: string
  nodeId: TLShapeId
  x: number
  y: number
}

type ReplayCursor = {
  color: string
  name: string
  role: UserRole
  sessionId: string
  x: number
  y: number
}

type CanvasEvent = {
  id: string
  at: string
  authorName: string
  authorRole: UserRole
  cursor?: ReplayCursor
  label: string
  nodeId?: string
  operation: 'created' | 'updated' | 'deleted'
  seq: number
  shape?: TLShape
  source: 'remote' | 'user'
}

type PresenceCursor = {
  color: string
  lastSeen: number
  name: string
  role: UserRole
  sessionId: string
  x: number
  y: number
}

type ActiveUser = {
  color: string
  name: string
  role: UserRole
  sessionId: string
}

type SyncDelta = {
  added: Record<string, TLShape>
  removed: Record<string, TLShape>
  updated: Record<string, [TLShape, TLShape]>
}

type StoreDiff = Parameters<Editor['store']['applyDiff']>[0]

type WelcomeMessage = {
  events?: CanvasEvent[]
  roomId: string
  senderSessionId: 'server'
  serverTime: number
  shapes?: TLShape[]
  taskUpdate?: number[]
  type: 'sync-welcome'
  users?: ActiveUser[]
}

type SocketMessage =
  | WelcomeMessage
  | { delta?: SyncDelta; events?: CanvasEvent[]; senderSessionId: string; type: 'canvas-delta' }
  | { rejected?: { id: string; reason: string }[]; type: 'mutation-rejected' }
  | { color: string; name: string; role: UserRole; sessionId: string; type: 'presence-cursor'; x: number; y: number }
  | { color?: string; name?: string; phase: 'join' | 'leave'; role?: UserRole; sessionId: string; type: 'presence-user' }
  | { senderSessionId: string; type: 'yjs-update'; update?: number[] }

type ReplayFrame = {
  at: string
  cursors: Record<string, ReplayCursor>
  label: string
  operation: 'created' | 'updated' | 'deleted'
  seq: number
  shapes: TLShape[]
}

const DEFAULT_ROOM_ID = 'ligma-devday-main'
const REMOTE_YJS_ORIGIN = 'remote-yjs-update'
const USER_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#e11d48', '#7c3aed']
const ROLES: UserRole[] = ['Lead', 'Contributor', 'Viewer']
const EMPTY_STATS: CanvasStats = {
  actionCount: 0,
  decisionCount: 0,
  eventCount: 0,
  nodeCount: 0,
  questionCount: 0,
  selectedNodeIds: [],
}

const intentCopy: Record<Intent, string> = {
  action: 'Action item',
  decision: 'Decision',
  question: 'Open question',
  reference: 'Reference',
}

const intentBadgeCopy: Record<Intent, string> = {
  action: '✨ action item',
  decision: '💡 decision',
  question: '❓ question',
  reference: '📎 reference',
}

const onboardingSteps = [
  { body: 'Add sticky nodes from the left rail when an idea needs a home.', title: 'Add sticky' },
  { body: 'Drag nodes around the infinite canvas while everyone stays in sync.', title: 'Drag to move' },
  { body: 'Type action, decision, or question language to populate tasks and badges.', title: 'Type to create task' },
]

function normalizeRoomId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')

  return normalized || DEFAULT_ROOM_ID
}

function readSearchRoomId() {
  const roomFromUrl = new URLSearchParams(window.location.search).get('room')
  return normalizeRoomId(roomFromUrl ?? DEFAULT_ROOM_ID)
}

function getStoredValue(key: string, fallback: string) {
  return window.localStorage.getItem(key) ?? fallback
}

/**
 * crypto.randomUUID() is gated behind secure-context in some browsers (notably
 * older Safari). When unavailable, fall back to a UUIDv4 built from
 * crypto.getRandomValues, which is always present in any browser that ships
 * SubtleCrypto. Math.random() is the last resort.
 */
function safeRandomUUID(): string {
  const c = (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined) as
    | (Crypto & { randomUUID?: () => string })
    | undefined
  if (c?.randomUUID) {
    try {
      return c.randomUUID()
    } catch {
      /* fall through */
    }
  }
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // RFC 4122 v4
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

function readStoredRole() {
  const storedRole = getStoredValue('ligma.userRole', 'Lead')
  return ROLES.includes(storedRole as UserRole) ? (storedRole as UserRole) : 'Lead'
}

function getColorIndex(color: string) {
  const colorIndex = USER_COLORS.indexOf(color)
  return colorIndex >= 0 ? colorIndex : 0
}

function getSyncUrl(guestInviteToken?: string) {
  const configuredUrl = import.meta.env.VITE_LIGMA_SYNC_URL as string | undefined
  if (configuredUrl) {
    return appendAuth(configuredUrl, guestInviteToken)
  }

  // Default: same-origin /ligma-sync (Vite proxies it in dev; Fastify serves
  // it in prod). For signed-in users we send ?token=<jwt>; for anonymous
  // viewers arriving via a Viewer invite we send ?invite=<token> instead.
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${protocol}://${window.location.host}/ligma-sync`
  return appendAuth(url, guestInviteToken)
}

function appendAuth(url: string, guestInviteToken?: string): string {
  if (guestInviteToken) {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}invite=${encodeURIComponent(guestInviteToken)}`
  }
  const token = window.localStorage.getItem('ligma.token')
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function parseSocketMessage(value: string): SocketMessage | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) && typeof parsed.type === 'string' ? (parsed as SocketMessage) : null
  } catch {
    return null
  }
}

function isShapeRecord(record: unknown): record is TLShape {
  return Boolean(
    record &&
      typeof record === 'object' &&
      'typeName' in record &&
      (record as { typeName?: unknown }).typeName === 'shape',
  )
}

function isRichText(value: unknown): value is TLRichText {
  return Boolean(value && typeof value === 'object' && 'type' in value)
}

function sanitizeRole(role: unknown): UserRole {
  return role === 'Lead' || role === 'Contributor' || role === 'Viewer' ? role : 'Viewer'
}

function sanitizeCursor(value: unknown): ReplayCursor | null {
  if (!isRecord(value)) return null
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId : null
  const name = typeof value.name === 'string' ? value.name : null
  const color = typeof value.color === 'string' ? value.color : null
  const x = typeof value.x === 'number' ? value.x : null
  const y = typeof value.y === 'number' ? value.y : null
  if (!sessionId || !name || !color || x === null || y === null) return null
  return {
    sessionId,
    name,
    color,
    role: sanitizeRole(value.role),
    x,
    y,
  }
}

function readNodeMeta(shape: TLShape): LigmaNodeMeta | null {
  const meta = shape.meta as Record<string, unknown>
  const ligmaMeta = meta.ligma

  if (!ligmaMeta || typeof ligmaMeta !== 'object') {
    return null
  }

  const data = ligmaMeta as Partial<LigmaNodeMeta>

  if (!data.authorId || !data.authorName || !data.createdAt) {
    return null
  }

  return {
    authorColorIndex: typeof data.authorColorIndex === 'number' ? data.authorColorIndex : 0,
    authorId: data.authorId,
    authorName: data.authorName,
    authorRole: sanitizeRole(data.authorRole),
    createdAt: data.createdAt,
    lockedToRoles: Array.isArray(data.lockedToRoles) ? data.lockedToRoles : [],
  }
}

function withNodeMeta(shape: TLShape, nextMeta: Partial<LigmaNodeMeta>) {
  const currentMeta = readNodeMeta(shape)
  const fallbackMeta: LigmaNodeMeta = {
    authorColorIndex: 0,
    authorId: 'unknown',
    authorName: 'Unknown',
    authorRole: 'Viewer',
    createdAt: new Date().toISOString(),
    lockedToRoles: [],
  }

  return {
    ...(shape.meta as Record<string, unknown>),
    ligma: {
      ...(currentMeta ?? fallbackMeta),
      ...nextMeta,
    },
  }
}

function canMutateShape(shape: TLShape, role: UserRole) {
  if (shape.type === 'draw') return role !== 'Viewer'
  const nodeMeta = readNodeMeta(shape)
  return !nodeMeta?.lockedToRoles.length || nodeMeta.lockedToRoles.includes(role)
}

function getShapeText(editor: Editor, shape: TLShape) {
  const richText = (shape.props as { richText?: unknown }).richText

  if (!isRichText(richText)) {
    return ''
  }

  try {
    return renderPlaintextFromRichText(editor, richText).trim()
  } catch {
    return ''
  }
}

/** Synchronous intent classification — reads from AI cache if available, else regex fallback. */
function classifyIntent(text: string, aiCache?: Map<string, IntentResult>): Intent {
  if (aiCache) {
    const cacheKey = text.trim().toLowerCase()
    const cached = aiCache.get(cacheKey)
    if (cached) return cached.intent
  }
  // Regex fallback (instant)
  return classifyIntentRegex(text).intent
}

function getShapeDeltaFromChanges(changes: StoreDiff): SyncDelta {
  const delta: SyncDelta = { added: {}, removed: {}, updated: {} }

  for (const [id, record] of Object.entries(changes.added)) {
    if (isShapeRecord(record)) delta.added[id] = record
  }

  for (const [id, value] of Object.entries(changes.updated)) {
    const [previousRecord, nextRecord] = value
    if (isShapeRecord(previousRecord) && isShapeRecord(nextRecord)) {
      delta.updated[id] = [previousRecord, nextRecord]
    }
  }

  for (const [id, record] of Object.entries(changes.removed)) {
    if (isShapeRecord(record)) delta.removed[id] = record
  }

  return delta
}

function isSyncDeltaEmpty(delta: SyncDelta) {
  return !Object.keys(delta.added).length && !Object.keys(delta.updated).length && !Object.keys(delta.removed).length
}

function applyShapeDelta(editor: Editor, delta: SyncDelta) {
  editor.store.mergeRemoteChanges(() => {
    editor.store.applyDiff(delta as unknown as StoreDiff, { runCallbacks: true })
  })
}

function applyShapeList(editor: Editor, shapes: TLShape[]) {
  const currentShapes = editor.getCurrentPageShapes()
  const nextShapesById = new Map(shapes.map((shape) => [shape.id, shape]))
  const delta: SyncDelta = { added: {}, removed: {}, updated: {} }

  for (const currentShape of currentShapes) {
    if (!nextShapesById.has(currentShape.id)) {
      delta.removed[currentShape.id] = currentShape
    }
  }

  for (const nextShape of shapes) {
    const currentShape = editor.getShape(nextShape.id)
    if (currentShape) {
      delta.updated[nextShape.id] = [currentShape, nextShape]
    } else {
      delta.added[nextShape.id] = nextShape
    }
  }

  applyShapeDelta(editor, delta)
}

// Apply a SyncDelta to a plain shape list (used to keep the offline live snapshot up to date
// while the user is scrubbing the replay timeline).
function applyDeltaToShapeList(shapes: TLShape[], delta: SyncDelta): TLShape[] {
  const byId = new Map(shapes.map((shape) => [shape.id as string, shape]))
  for (const [id, shape] of Object.entries(delta.added)) byId.set(id, shape)
  for (const [id, [, next]] of Object.entries(delta.updated)) byId.set(id, next)
  for (const id of Object.keys(delta.removed)) byId.delete(id)
  return Array.from(byId.values())
}

function buildCanvasSnapshot(editor: Editor, events: CanvasEvent[], aiCache?: Map<string, IntentResult>) {
  const shapes = editor.getCurrentPageShapes()
  const tasks: CanvasTask[] = []
  const badges: CanvasIntentBadge[] = []
  const locks: CanvasLockBadge[] = []
  const seenShapeIds = new Set<TLShapeId>()
  let actionCount = 0
  let decisionCount = 0
  let questionCount = 0

  for (const shape of shapes) {
    if (seenShapeIds.has(shape.id)) continue
    seenShapeIds.add(shape.id)

    const nodeMeta = readNodeMeta(shape)
    const bounds = editor.getShapePageBounds(shape.id)

    // Lock badges — show on ALL locked shapes regardless of text content
    if (nodeMeta?.lockedToRoles?.length && bounds) {
      const lockPoint = editor.pageToViewport({ x: bounds.x, y: bounds.y + bounds.h - 6 })
      locks.push({
        label: `🔒 ${nodeMeta.lockedToRoles.join(', ')}`,
        nodeId: shape.id,
        x: lockPoint.x,
        y: lockPoint.y,
      })
    }

    const text = getShapeText(editor, shape)

    if (!text) {
      continue
    }

    const intent = classifyIntent(text, aiCache)

    if (bounds) {
      const badgePoint = editor.pageToViewport({ x: bounds.x + bounds.w - 18, y: bounds.y - 10 })
      badges.push({ intent, label: intentBadgeCopy[intent], nodeId: shape.id, x: badgePoint.x, y: badgePoint.y })
    }

    if (intent === 'action') {
      actionCount += 1
      tasks.push({
        authorColorIndex: nodeMeta?.authorColorIndex ?? 0,
        authorName: nodeMeta?.authorName ?? 'Unknown',
        authorRole: nodeMeta?.authorRole ?? 'Viewer',
        createdAt: nodeMeta?.createdAt ?? new Date().toISOString(),
        intent,
        nodeId: shape.id,
        title: text.length > 88 ? `${text.slice(0, 85)}...` : text,
      })
    }

    if (intent === 'decision') {
      decisionCount += 1
    }

    if (intent === 'question') {
      questionCount += 1
    }
  }

  return {
    badges,
    locks,
    stats: {
      actionCount,
      decisionCount,
      eventCount: events.length,
      nodeCount: shapes.length,
      questionCount,
      selectedNodeIds: editor.getSelectedShapeIds(),
    },
    tasks,
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Smart timestamp: shows relative time for recent events, full date otherwise. */
function formatTimestamp(value: string) {
  const date = new Date(value)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24 && date.getDate() === now.getDate()) return `${diffHr}h ago`

  // Different day — show short date + time
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function tasksFingerprint(tasks: CanvasTask[]) {
  return JSON.stringify(tasks.map(({ authorName, createdAt, nodeId, title }) => ({ authorName, createdAt, nodeId, title })))
}

function dedupeCanvasTasks(tasks: CanvasTask[]) {
  const seenNodeIds = new Set<TLShapeId>()
  const nextTasks: CanvasTask[] = []

  for (const task of tasks) {
    if (seenNodeIds.has(task.nodeId)) continue
    seenNodeIds.add(task.nodeId)
    nextTasks.push(task)
  }

  return nextTasks
}

interface AppProps {
  onBackToHome?: () => void
  roomError?: string | null
  clearRoomError?: () => void
  guestInviteToken?: string
}

function App({ onBackToHome, roomError, clearRoomError, guestInviteToken }: AppProps = {}) {
  const isGuest = Boolean(guestInviteToken)
  const [roomId, setRoomId] = useState(readSearchRoomId)
  const [showInvite, setShowInvite] = useState(false)
  const [roomInput, setRoomInput] = useState(roomId)
  const [userName, setUserName] = useState(() =>
    isGuest ? `Guest ${Math.floor(Math.random() * 9000 + 1000)}` : getStoredValue('ligma.userName', 'DevDay Lead'),
  )
  const [userColor, setUserColor] = useState(() => getStoredValue('ligma.userColor', USER_COLORS[0]))
  const [userRole, setUserRole] = useState<UserRole>(() => (isGuest ? 'Viewer' : readStoredRole()))
  // Fetch the actual role for THIS specific room so the Invite button etc.
  // reflect per-room membership rather than the role baked into the JWT.
  useEffect(() => {
    if (isGuest) return
    let cancelled = false
    const userId = window.localStorage.getItem('ligma.userId')
    const token = window.localStorage.getItem('ligma.token')
    if (!userId || !token) return
    fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const room = data as {
          owner_id?: string
          members?: Array<{ user_id: string; role: UserRole }>
        }
        const members = room.members ?? []
        const me = members.find((m) => m.user_id === userId)
        // The owner_id is the source of truth for "Lead-ness" — they created
        // the room. If membership row hasn't propagated yet, falling back to
        // owner_id keeps the Invite button visible immediately after creation.
        let role: UserRole | null = me?.role ?? null
        if (!role && room.owner_id === userId) role = 'Lead'
        if (role) {
          setUserRole(role)
          window.localStorage.setItem('ligma.userRole', role)
        }
      })
      .catch(() => {
        /* ignore — fall back to stored role */
      })
    return () => {
      cancelled = true
    }
  }, [roomId])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [events, setEvents] = useState<CanvasEvent[]>([])
  const [tasks, setTasks] = useState<CanvasTask[]>([])
  const [intentBadges, setIntentBadges] = useState<CanvasIntentBadge[]>([])
  const [lockBadges, setLockBadges] = useState<CanvasLockBadge[]>([])
  const [stats, setStats] = useState<CanvasStats>(EMPTY_STATS)
  const [shareLabel, setShareLabel] = useState('Copy room link')
  const [guardLabel, setGuardLabel] = useState('Node access ready')
  const [guardFlash, setGuardFlash] = useState(false)
  const [presenceCursors, setPresenceCursors] = useState<Record<string, PresenceCursor>>({})
  const [replayCursors, setReplayCursors] = useState<Record<string, ReplayCursor>>({})
  const [activeUsers, setActiveUsers] = useState<Record<string, ActiveUser>>({})
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isEditBarVisible, setIsEditBarVisible] = useState(true)
  const [highlightedNodeId, setHighlightedNodeId] = useState<TLShapeId | null>(null)
  const [onboardingStep, setOnboardingStep] = useState(() =>
    window.localStorage.getItem('ligma.onboardingComplete') === 'true' ? onboardingSteps.length : 0,
  )
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([])
  const [replayIndex, setReplayIndex] = useState(0)
  const [isReplayMode, setIsReplayMode] = useState(false)
  const [isReplayPlaying, setIsReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [aiModelStatus, setAiModelStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [aiModelProgress, setAiModelProgress] = useState(0)
  const [summaryContent, setSummaryContent] = useState('')
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const canvasStageRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const eventsRef = useRef<CanvasEvent[]>([])
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const pendingWelcomeRef = useRef<WelcomeMessage | null>(null)
  const lastEventSeqRef = useRef(0)
  const taskFingerprintRef = useRef('')
  // The authoritative "live" shape state, kept up to date even while user is scrubbing replay.
  const liveShapeMapRef = useRef<Map<string, TLShape>>(new Map())
  const replayShapeMapRef = useRef<Map<string, TLShape>>(new Map())
  const replayCursorMapRef = useRef<Record<string, ReplayCursor>>({})
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  // Snapshot of live shapes captured the moment replay started; used to restore live canvas.
  const replayLiveSnapshotRef = useRef<TLShape[] | null>(null)
  const isReplayModeRef = useRef(false)
  // Mirror of replayFrames state — lets the replay playback loop always access the latest
  // frames without being in the useEffect dependency array (which would restart the loop on
  // every new incoming event).
  const replayFramesRef = useRef<ReplayFrame[]>([])
  // Timer refs for debouncing expensive operations during high-frequency store updates
  const snapshotTimerRef = useRef<number | null>(null)
  const badgeRafRef = useRef<number | null>(null)
  const eventListRef = useRef<HTMLDivElement | null>(null)
  const aiCacheRef = useRef<Map<string, IntentResult>>(new Map())
  const aiClassifyTimerRef = useRef<number | null>(null)
  const presenceSessionId = useMemo(() => safeRandomUUID(), [])
  // Refs for values read inside the WS effect without causing reconnects (G5 fix)
  const userRoleRef = useRef(userRole)
  const userNameRef = useRef(userName)
  const userColorRef = useRef(userColor)
  const taskDoc = useMemo(() => new Y.Doc(), [])
  const taskArray = useMemo(() => taskDoc.getArray<CanvasTask>('tasks'), [taskDoc])

  const userPreferences = useAtom<TLUserPreferences>('ligma-user-preferences', () => ({
    ...defaultUserPreferences,
    id: getStoredValue('ligma.userId', safeRandomUUID()),
    name: userName,
    color: userColor,
    colorScheme: 'light',
  }))

  const tldrawUser = useMemo(() => createTLUser({ userPreferences }), [userPreferences])

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    isReplayModeRef.current = isReplayMode
  }, [isReplayMode])

  // Keep refs in sync with latest state — these are read from WS handlers
  // without being in the WS useEffect dependency array (G5 fix).
  useEffect(() => { userRoleRef.current = userRole }, [userRole])
  useEffect(() => { userNameRef.current = userName }, [userName])
  useEffect(() => { userColorRef.current = userColor }, [userColor])
  useEffect(() => { replayFramesRef.current = replayFrames }, [replayFrames])

  // Preload AI model on mount (downloads once, cached in IndexedDB)
  useEffect(() => {
    preloadModel((info) => {
      if (info.status === 'progress' || info.status === 'download') {
        setAiModelProgress(Math.round(info.progress))
      }
    })
      .then(() => {
        setAiModelStatus(isModelReady() ? 'ready' : 'failed')
        // If model loaded and editor is ready, re-run classification
        if (isModelReady() && editorRef.current) {
          const snap = buildCanvasSnapshot(editorRef.current, eventsRef.current, aiCacheRef.current)
          setStats(snap.stats)
          setIntentBadges(snap.badges)
          setLockBadges(snap.locks)
        }
      })
      .catch(() => setAiModelStatus('failed'))
  }, [])

  const sendSocketMessage = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }, [])

  // G5: Send role-update WS message when role/name/color changes (no reconnect).
  // Runs after initial mount — the hello message already carries the initial values.
  const roleUpdateMountedRef = useRef(false)
  useEffect(() => {
    if (!roleUpdateMountedRef.current) {
      roleUpdateMountedRef.current = true
      return
    }
    sendSocketMessage({
      type: 'role-update',
      role: userRole,
      name: userName,
      color: userColor,
    })
  }, [userRole, userName, userColor, sendSocketMessage])

  const publishTasksToYjs = useCallback((nextTasks: CanvasTask[]) => {
    const projectedTasks = dedupeCanvasTasks(nextTasks)
    const fingerprint = tasksFingerprint(projectedTasks)
    if (taskFingerprintRef.current === fingerprint) return

    taskFingerprintRef.current = fingerprint
    taskDoc.transact(() => {
      if (taskArray.length) taskArray.delete(0, taskArray.length)
      if (projectedTasks.length) taskArray.insert(0, projectedTasks)
    }, 'local-task-projection')
  }, [taskArray, taskDoc])

  const refreshCanvasSnapshot = useCallback(
    (activeEditor: Editor, shouldPublishTasks = true) => {
      const snapshot = buildCanvasSnapshot(activeEditor, eventsRef.current, aiCacheRef.current)
      setStats(snapshot.stats)
      setIntentBadges(snapshot.badges)
      setLockBadges(snapshot.locks)
      if (shouldPublishTasks && !isReplayModeRef.current) {
        publishTasksToYjs(snapshot.tasks)
      }

      // Queue async AI classification for shapes that might need reclassification
      if (isModelReady() && !isReplayModeRef.current) {
        if (aiClassifyTimerRef.current) window.clearTimeout(aiClassifyTimerRef.current)
        aiClassifyTimerRef.current = window.setTimeout(() => {
          aiClassifyTimerRef.current = null
          const shapes = activeEditor.getCurrentPageShapes()
          let needsRefresh = false
          const promises: Promise<void>[] = []
          for (const shape of shapes) {
            const text = getShapeText(activeEditor, shape)
            if (!text || text.trim().length < 3) continue
            const cacheKey = text.trim().toLowerCase()
            if (aiCacheRef.current.has(cacheKey)) continue
            promises.push(
              classifyIntentAI(text).then((result) => {
                aiCacheRef.current.set(cacheKey, result)
                needsRefresh = true
              }),
            )
          }
          if (promises.length > 0) {
            Promise.all(promises).then(() => {
              if (needsRefresh && editorRef.current) {
                const snap = buildCanvasSnapshot(editorRef.current, eventsRef.current, aiCacheRef.current)
                setStats(snap.stats)
                setIntentBadges(snap.badges)
                setLockBadges(snap.locks)
                if (shouldPublishTasks && !isReplayModeRef.current) {
                  publishTasksToYjs(snap.tasks)
                }
              }
            })
          }
        }, 300)
      }
    },
    [publishTasksToYjs],
  )

  const appendEvents = useCallback((incomingEvents: CanvasEvent[], liveShapesForFrame?: TLShape[] | null) => {
    if (!incomingEvents.length) return

    const orderedIncoming = [...incomingEvents].sort((left, right) => left.seq - right.seq)
    const cursorMap = { ...replayCursorMapRef.current }
    const shapeMap = replayShapeMapRef.current

    if (!shapeMap.size && liveShapesForFrame?.length) {
      for (const shape of liveShapesForFrame) {
        shapeMap.set(shape.id, shape)
      }
    }

    const newestSeq = Math.max(...incomingEvents.map((event) => event.seq))
    lastEventSeqRef.current = Math.max(lastEventSeqRef.current, newestSeq)

    setEvents((currentEvents) => {
      const seenIds = new Set<string>()
      const nextEvents = [...incomingEvents, ...currentEvents]
        .filter((event) => {
          if (seenIds.has(event.id)) return false
          seenIds.add(event.id)
          return true
        })
        .sort((left, right) => right.seq - left.seq)
        .slice(0, 120)

      eventsRef.current = nextEvents
      return nextEvents
    })

    const framesToAdd: ReplayFrame[] = []

    for (const event of orderedIncoming) {
      if (event.cursor) {
        cursorMap[event.cursor.sessionId] = event.cursor
      }

      if (event.shape && isShapeRecord(event.shape)) {
        if (event.operation === 'deleted') shapeMap.delete(event.shape.id)
        else shapeMap.set(event.shape.id, event.shape)
      }

      framesToAdd.push({
        at: event.at,
        label: event.label,
        operation: event.operation,
        seq: event.seq,
        shapes: Array.from(shapeMap.values()).map((shape) => ({ ...shape })),
        cursors: { ...cursorMap },
      })
    }

    replayCursorMapRef.current = cursorMap
    replayShapeMapRef.current = shapeMap

    setReplayFrames((currentFrames) => {
      const nextFrames = [...currentFrames, ...framesToAdd]
      if (!isReplayModeRef.current) {
        setReplayIndex(Math.max(0, nextFrames.length - 1))
      }
      return nextFrames
    })
  }, [])

  const applyWelcome = useCallback(
    (message: WelcomeMessage, activeEditor: Editor) => {
      applyShapeList(activeEditor, message.shapes ?? [])
      liveShapeMapRef.current = new Map((message.shapes ?? []).map((shape) => [shape.id, shape]))

      if (message.taskUpdate?.length) {
        Y.applyUpdate(taskDoc, Uint8Array.from(message.taskUpdate), REMOTE_YJS_ORIGIN)
      }

      const welcomeEvents = (message.events ?? []).map((event) => ({
        ...event,
        authorRole: sanitizeRole(event.authorRole),
        cursor: sanitizeCursor(event.cursor) ?? undefined,
        shape: event.shape && isShapeRecord(event.shape) ? event.shape : undefined,
      }))
      eventsRef.current = welcomeEvents.sort((left, right) => right.seq - left.seq)
      setEvents(eventsRef.current)

      if (welcomeEvents.length) {
        lastEventSeqRef.current = Math.max(...welcomeEvents.map((event) => event.seq))
      }

      setActiveUsers(
        Object.fromEntries(
          (message.users ?? []).map((user) => [user.sessionId, { ...user, role: sanitizeRole(user.role) }]),
        ),
      )
      const orderedEvents = [...welcomeEvents].sort((left, right) => left.seq - right.seq)
      const cursorMap: Record<string, ReplayCursor> = {}
      const shapeMap = new Map<string, TLShape>()
      const frames: ReplayFrame[] = []

      for (const event of orderedEvents) {
        if (event.cursor) {
          cursorMap[event.cursor.sessionId] = event.cursor
        }

        if (event.shape && isShapeRecord(event.shape)) {
          if (event.operation === 'deleted') shapeMap.delete(event.shape.id)
          else shapeMap.set(event.shape.id, event.shape)
        }

        frames.push({
          at: event.at,
          label: event.label,
          operation: event.operation,
          seq: event.seq,
          shapes: Array.from(shapeMap.values()).map((shape) => ({ ...shape })),
          cursors: { ...cursorMap },
        })
      }

      if (!frames.length) {
        const seedShapes = (message.shapes ?? []).map((shape) => ({ ...shape }))
        frames.push({
          at: new Date(message.serverTime).toISOString(),
          label: 'Joined live room',
          operation: 'updated',
          seq: lastEventSeqRef.current,
          shapes: seedShapes,
          cursors: {},
        })
        replayShapeMapRef.current = new Map(seedShapes.map((shape) => [shape.id, shape]))
        replayCursorMapRef.current = {}
      } else {
        replayShapeMapRef.current = shapeMap
        replayCursorMapRef.current = cursorMap
      }

      setReplayFrames(frames)
      setReplayIndex(Math.max(0, frames.length - 1))
      setReplayCursors({})
      refreshCanvasSnapshot(activeEditor, false)
    },
    [refreshCanvasSnapshot, taskDoc],
  )

  useEffect(() => {
    window.localStorage.setItem('ligma.userId', userPreferences.get().id)
    window.localStorage.setItem('ligma.userName', userName)
    window.localStorage.setItem('ligma.userColor', userColor)
    window.localStorage.setItem('ligma.userRole', userRole)

    userPreferences.set({
      ...userPreferences.get(),
      name: userName,
      color: userColor,
      colorScheme: 'light',
    })
  }, [userColor, userName, userPreferences, userRole])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('room', roomId)
    window.history.replaceState(null, '', url)
  }, [roomId])

  useEffect(() => {
    const syncTaskState = () => setTasks(dedupeCanvasTasks(taskArray.toArray()))
    taskArray.observe(syncTaskState)
    syncTaskState()
    return () => taskArray.unobserve(syncTaskState)
  }, [taskArray])

  // G10: Auto-scroll event log to newest entry when events change
  useEffect(() => {
    if (eventListRef.current) {
      eventListRef.current.scrollTop = 0
    }
  }, [events])

  useEffect(() => {
    const handleYjsUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_YJS_ORIGIN) return
      sendSocketMessage({ type: 'yjs-update', update: Array.from(update) })
    }

    taskDoc.on('update', handleYjsUpdate)
    return () => taskDoc.off('update', handleYjsUpdate)
  }, [sendSocketMessage, taskDoc])

  useEffect(() => {
    let disposed = false

    const connect = () => {
      if (disposed) return

      setConnectionStatus('connecting')
      const socket = new WebSocket(getSyncUrl(guestInviteToken))
      socketRef.current = socket

      socket.addEventListener('open', () => {
        setConnectionStatus('online')
        sendSocketMessage({
          color: userColorRef.current,
          lastEventSeq: lastEventSeqRef.current,
          name: userNameRef.current,
          role: userRoleRef.current,
          roomId,
          sessionId: presenceSessionId,
          type: 'hello',
        })
      })

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        const message = parseSocketMessage(event.data)
        if (!message) return

        if (message.type === 'sync-welcome') {
          setConnectionStatus('online')
          const activeEditor = editorRef.current
          if (activeEditor) {
            applyWelcome(message, activeEditor)
          } else {
            pendingWelcomeRef.current = message
          }
          return
        }

        if (message.type === 'canvas-delta') {
          const activeEditor = editorRef.current
          if (!activeEditor) return

          const isFromSelf = message.senderSessionId === presenceSessionId
          const hasDelta = !!message.delta && !isSyncDeltaEmpty(message.delta)

          if (!isFromSelf && hasDelta) {
            if (isReplayModeRef.current) {
              // While scrubbing replay, keep the offline live snapshot fresh so we can
              // restore correctly, but DO NOT touch the editor (which currently shows history).
              const currentLive = Array.from(liveShapeMapRef.current.values())
              const nextLive = applyDeltaToShapeList(currentLive, message.delta!)
              liveShapeMapRef.current = new Map(nextLive.map((shape) => [shape.id, shape]))
              if (replayLiveSnapshotRef.current) {
                replayLiveSnapshotRef.current = nextLive
              }
            } else {
              applyShapeDelta(activeEditor, message.delta!)
            }
          }

          const serverEvents = (message.events ?? []).map((event) => ({
            ...event,
            authorRole: sanitizeRole(event.authorRole),
            cursor: sanitizeCursor(event.cursor) ?? undefined,
            shape: event.shape && isShapeRecord(event.shape) ? event.shape : undefined,
          }))
          appendEvents(serverEvents, Array.from(liveShapeMapRef.current.values()))
          if (!isReplayModeRef.current) {
            refreshCanvasSnapshot(activeEditor, false)
          }
          return
        }

        if (message.type === 'mutation-rejected') {
          setGuardLabel(message.rejected?.map((item) => item.reason).join(' / ') || 'Mutation rejected')
          // G4: Flash animation to draw attention to the rejection
          setGuardFlash(true)
          window.setTimeout(() => setGuardFlash(false), 1200)
          return
        }

        if (message.type === 'presence-cursor') {
          if (message.sessionId === presenceSessionId) return
          setPresenceCursors((currentCursors) => ({
            ...currentCursors,
            [message.sessionId]: {
              color: message.color,
              lastSeen: Date.now(),
              name: message.name,
              role: sanitizeRole(message.role),
              sessionId: message.sessionId,
              x: message.x,
              y: message.y,
            },
          }))
          return
        }

        if (message.type === 'presence-user') {
          setActiveUsers((currentUsers) => {
            if (message.phase === 'leave') {
              const nextUsers = { ...currentUsers }
              delete nextUsers[message.sessionId]
              return nextUsers
            }

            return {
              ...currentUsers,
              [message.sessionId]: {
                color: message.color ?? USER_COLORS[0],
                name: message.name ?? 'Anonymous',
                role: sanitizeRole(message.role),
                sessionId: message.sessionId,
              },
            }
          })
          return
        }

        if (message.type === 'yjs-update' && message.senderSessionId !== presenceSessionId && message.update?.length) {
          Y.applyUpdate(taskDoc, Uint8Array.from(message.update), REMOTE_YJS_ORIGIN)
        }
      })

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null
        setConnectionStatus('offline')
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 700)
        }
      })

      socket.addEventListener('error', () => {
        setConnectionStatus('offline')
        socket.close()
      })
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
      socketRef.current = null
    }
  // G5: userRole, userName, userColor removed from deps — read from refs inside
  // the effect so changing role/name/color does NOT cause WS reconnect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendEvents, applyWelcome, presenceSessionId, refreshCanvasSnapshot, roomId, sendSocketMessage, taskDoc])

  useEffect(() => {
    if (!editor || !pendingWelcomeRef.current) return

    applyWelcome(pendingWelcomeRef.current, editor)
    pendingWelcomeRef.current = null
  }, [applyWelcome, editor])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const stageElement = canvasStageRef.current
      const activeEditor = editorRef.current
      if (!stageElement || !activeEditor || connectionStatus !== 'online') return

      const stageRect = stageElement.getBoundingClientRect()
      const isInsideStage =
        event.clientX >= stageRect.left &&
        event.clientX <= stageRect.right &&
        event.clientY >= stageRect.top &&
        event.clientY <= stageRect.bottom

      if (!isInsideStage) return
      // Convert mouse position into tldraw PAGE coordinates so other clients can render
      // it correctly regardless of their own camera (pan/zoom).
      const pagePoint = activeEditor.screenToPage({
        x: event.clientX - stageRect.left,
        y: event.clientY - stageRect.top,
      })
      lastPointerRef.current = pagePoint
      sendSocketMessage({
        type: 'presence-cursor',
        x: pagePoint.x,
        y: pagePoint.y,
      })
    }

    const removeStaleCursors = window.setInterval(() => {
      setPresenceCursors((currentCursors) =>
        Object.fromEntries(
          Object.entries(currentCursors).filter(([, cursor]) => Date.now() - cursor.lastSeen < 3000),
        ),
      )
    }, 1000)

    window.addEventListener('pointermove', handlePointerMove)

    return () => {
      window.clearInterval(removeStaleCursors)
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [connectionStatus, sendSocketMessage])

  // Lightweight badge-position updater — fires on camera pan/zoom (session scope) but only
  // recalculates viewport coordinates, never rebuilds tasks or re-classifies text.
  useEffect(() => {
    if (!editor) return
    const removeBadgeListener = editor.store.listen(
      () => {
        if (badgeRafRef.current !== null) return
        badgeRafRef.current = window.requestAnimationFrame(() => {
          badgeRafRef.current = null
          if (isReplayModeRef.current) return
          setIntentBadges((prev) => {
            if (!prev.length) return prev
            return prev.map((badge) => {
              const bounds = editor.getShapePageBounds(badge.nodeId)
              if (!bounds) return badge
              const pt = editor.pageToViewport({ x: bounds.x + bounds.w - 18, y: bounds.y - 10 })
              return pt.x === badge.x && pt.y === badge.y ? badge : { ...badge, x: pt.x, y: pt.y }
            })
          })
          setLockBadges((prev) => {
            if (!prev.length) return prev
            return prev.map((lock) => {
              const bounds = editor.getShapePageBounds(lock.nodeId)
              if (!bounds) return lock
              const pt = editor.pageToViewport({ x: bounds.x, y: bounds.y + bounds.h - 6 })
              return pt.x === lock.x && pt.y === lock.y ? lock : { ...lock, x: pt.x, y: pt.y }
            })
          })
        })
      },
      { scope: 'session', source: 'all' },
    )
    return () => {
      removeBadgeListener()
      if (badgeRafRef.current !== null) {
        window.cancelAnimationFrame(badgeRafRef.current)
        badgeRafRef.current = null
      }
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return

    const removeBeforeCreate = editor.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
      if (source !== 'user') return shape
      if (isReplayModeRef.current) {
        setGuardLabel('Replay preview is read-only')
        return shape
      }
      // G1: Block Viewer from creating any shapes client-side
      if (userRole === 'Viewer') {
        setGuardLabel('Viewers cannot create nodes')
        setGuardFlash(true)
        window.setTimeout(() => setGuardFlash(false), 1200)
        return shape
      }

      return {
        ...shape,
        meta: withNodeMeta(shape, {
          authorColorIndex: getColorIndex(userColor),
          authorId: userPreferences.get().id,
          authorName: userName,
          authorRole: userRole,
          createdAt: new Date().toISOString(),
          lockedToRoles: [],
        }),
      }
    })

    const removeBeforeChange = editor.sideEffects.registerBeforeChangeHandler('shape', (previousShape, nextShape, source) => {
      if (source !== 'user') return nextShape
      if (isReplayModeRef.current) {
        setGuardLabel('Replay preview is read-only')
        return previousShape
      }
      if (userRole === 'Viewer') {
        setGuardLabel('Viewers cannot edit nodes')
        setGuardFlash(true)
        window.setTimeout(() => setGuardFlash(false), 1200)
        return previousShape
      }
      if (canMutateShape(previousShape, userRole)) return nextShape

      setGuardLabel(`Locked for ${readNodeMeta(previousShape)?.lockedToRoles.join(', ')}`)
      return previousShape
    })

    const removeBeforeDelete = editor.sideEffects.registerBeforeDeleteHandler('shape', (shape, source) => {
      if (source !== 'user') return
      if (isReplayModeRef.current) {
        setGuardLabel('Replay preview is read-only')
        return false
      }
      if (userRole === 'Viewer') {
        setGuardLabel('Viewers cannot delete nodes')
        setGuardFlash(true)
        window.setTimeout(() => setGuardFlash(false), 1200)
        return false
      }
      if (canMutateShape(shape, userRole)) return

      setGuardLabel(`Locked for ${readNodeMeta(shape)?.lockedToRoles.join(', ')}`)
      return false
    })

    const removeStoreListener = editor.store.listen(
      ({ changes, source }) => {
        // scope:'document' means this only fires for actual canvas content changes
        // (shapes, pages) — camera pan, hover, selection state never reach here.
        const delta = getShapeDeltaFromChanges(changes)

        // 1. Send WS delta immediately — never debounce real-time sync.
        if (source === 'user' && !isReplayModeRef.current && !isSyncDeltaEmpty(delta)) {
          const cursor = lastPointerRef.current
          sendSocketMessage(cursor ? { delta, type: 'canvas-delta', cursor } : { delta, type: 'canvas-delta' })
        }

        // 2. Keep the live shape map in sync using the delta (no full re-iteration).
        if (!isReplayModeRef.current && !isSyncDeltaEmpty(delta)) {
          const map = liveShapeMapRef.current
          for (const [id, shape] of Object.entries(delta.added)) map.set(id, shape)
          for (const [id, [, next]] of Object.entries(delta.updated)) map.set(id, next)
          for (const id of Object.keys(delta.removed)) map.delete(id)

          // 3. Debounce the expensive snapshot rebuild (badges, tasks, stats).
          // During freehand drawing, tldraw updates the store ~60×/s — we only need
          // to classify text and compute positions once the stroke settles.
          if (snapshotTimerRef.current) window.clearTimeout(snapshotTimerRef.current)
          snapshotTimerRef.current = window.setTimeout(() => {
            snapshotTimerRef.current = null
            refreshCanvasSnapshot(editor, source === 'user')
          }, 150)
        }
      },
      { scope: 'document', source: 'all' },
    )

    return () => {
      removeBeforeCreate()
      removeBeforeChange()
      removeBeforeDelete()
      removeStoreListener()
    }
  }, [editor, refreshCanvasSnapshot, sendSocketMessage, userColor, userName, userPreferences, userRole])

  useEffect(() => {
    if (!isReplayPlaying || !editor) return
    const activeEditor = editor

    const frames = replayFramesRef.current
    if (frames.length <= 1) {
      setIsReplayPlaying(false)
      return
    }

    let cancelled = false
    // Capture the starting index from the current render so playback resumes
    // from wherever the scrubber was (or from 0 if just entered replay mode).
    const startIndex = replayIndex

    function step(fromIndex: number) {
      if (cancelled) return
      const frames = replayFramesRef.current
      const nextIndex = fromIndex + 1

      if (nextIndex >= frames.length) {
        setIsReplayPlaying(false)
        return
      }

      const fromFrame = frames[fromIndex]!
      const toFrame = frames[nextIndex]!

      // Time-accurate pacing: scale actual inter-event delta to a reasonable
      // playback window. Raw delta * 0.2 gives 1 second of real time ≈ 200 ms
      // of replay. Floor at 150 ms so rapid-fire events are still visible;
      // cap at 1500 ms so long pauses in the session don't stall playback.
      const rawDelta = new Date(toFrame.at).getTime() - new Date(fromFrame.at).getTime()
      const scaledDelay = Math.max(150, Math.min(rawDelta * 0.2, 1500)) / replaySpeed

      window.setTimeout(() => {
        if (cancelled) return

        if (!replayLiveSnapshotRef.current) {
          replayLiveSnapshotRef.current = Array.from(liveShapeMapRef.current.values())
        }
        isReplayModeRef.current = true
        setIsReplayMode(true)
        setReplayIndex(nextIndex)
        applyShapeList(activeEditor, toFrame.shapes)
        setReplayCursors(toFrame.cursors)

        if (nextIndex >= replayFramesRef.current.length - 1) {
          setIsReplayPlaying(false)
        } else {
          step(nextIndex)
        }
      }, scaledDelay)
    }

    step(startIndex)

    return () => { cancelled = true }
  // replayIndex and replayFrames intentionally omitted: the closure captures
  // startIndex once (correct starting position) and replayFramesRef provides
  // always-fresh frames without restarting the loop on every new incoming event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplayPlaying, editor, replaySpeed])

  const applyRoomChange = useCallback(() => {
    const nextRoomId = normalizeRoomId(roomInput)
    setRoomId(nextRoomId)
    setRoomInput(nextRoomId)
    setEditor(null)
    setEvents([])
    eventsRef.current = []
    setTasks([])
    taskFingerprintRef.current = ''
    taskDoc.transact(() => {
      if (taskArray.length) taskArray.delete(0, taskArray.length)
    }, 'local-room-reset')
    setStats(EMPTY_STATS)
    setIntentBadges([])
    setPresenceCursors({})
    setReplayFrames([])
    setReplayIndex(0)
    setReplayCursors({})
    replayCursorMapRef.current = {}
    replayShapeMapRef.current = new Map()
    replayLiveSnapshotRef.current = null
    lastEventSeqRef.current = 0
    clearIntentCache()
    aiCacheRef.current = new Map()
  }, [roomInput, taskArray, taskDoc])

  const copyRoomLink = useCallback(async () => {
    const text = window.location.href
    let ok = false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch {
      /* fall through to legacy path */
    }
    if (!ok) {
      // Legacy fallback for plain-HTTP / older Safari: a transient textarea
      // + document.execCommand('copy'). Required because Clipboard API only
      // works in secure contexts.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    setShareLabel(ok ? 'Copied' : 'Copy failed — select URL manually')
    window.setTimeout(() => setShareLabel('Copy room link'), ok ? 1200 : 2400)
  }, [])

  const generateAISummary = useCallback(async () => {
    if (!editor) return
    setSummaryGenerating(true)
    try {
      const shapes = editor.getCurrentPageShapes()
      const classifiedNodes: Array<{
        id: string
        text: string
        intentResult: IntentResult
        authorName: string
        authorRole: string
        createdAt: string
      }> = []

      for (const shape of shapes) {
        const text = getShapeText(editor, shape)
        if (!text || text.trim().length < 3) continue
        const nodeMeta = readNodeMeta(shape)
        const result = await classifyIntentAI(text)
        classifiedNodes.push({
          id: shape.id,
          text: text.length > 200 ? `${text.slice(0, 197)}...` : text,
          intentResult: result,
          authorName: nodeMeta?.authorName ?? 'Unknown',
          authorRole: nodeMeta?.authorRole ?? 'Viewer',
          createdAt: nodeMeta?.createdAt ?? new Date().toISOString(),
        })
      }

      const participants = Object.values(activeUsers).map((u) => ({
        name: u.name,
        role: u.role,
        color: u.color,
      }))

      const summaryData = buildSummaryData({ roomId, nodes: classifiedNodes, participants })
      let markdown = ''
      try {
        const response = await requestAiSummary(summaryData)
        markdown = typeof response.markdown === 'string' && response.markdown.trim()
          ? response.markdown
          : ''
      } catch (err) {
        console.warn('[ai-summary] AI summary failed, using local formatter:', err)
      }
      if (!markdown) {
        markdown = formatSummaryMarkdown(summaryData)
      }
      setSummaryContent(markdown)
      setShowSummaryModal(true)
    } catch (err) {
      console.error('[ai-summary] Failed to generate summary:', err)
    } finally {
      setSummaryGenerating(false)
    }
  }, [editor, roomId, activeUsers])

  const setTool = useCallback(
    (toolId: string) => {
      editor?.setCurrentTool(toolId)
    },
    [editor],
  )

  const createNode = useCallback(
    (type: 'action-note' | 'decision-shape' | 'question-text') => {
      if (!editor || isReplayMode) return
      // G2: Block Viewer from using create-node helpers
      if (userRole === 'Viewer') {
        setGuardLabel('Viewers cannot create nodes')
        setGuardFlash(true)
        window.setTimeout(() => setGuardFlash(false), 1200)
        return
      }

      const viewport = editor.getViewportPageBounds()
      const xPosition = viewport.x + viewport.w / 2 - 130
      const yPosition = viewport.y + viewport.h / 2 - 70
      const shapeId = createShapeId()

      if (type === 'action-note') {
        editor.createShape<TLNoteShape>({
          id: shapeId,
          type: 'note',
          x: xPosition,
          y: yPosition,
          props: { richText: toRichText('Action: ') },
        })
      }

      if (type === 'decision-shape') {
        editor.createShape<TLGeoShape>({
          id: shapeId,
          type: 'geo',
          x: xPosition,
          y: yPosition,
          props: { geo: 'rectangle', h: 120, richText: toRichText('Decision: '), w: 260 },
        })
      }

      if (type === 'question-text') {
        editor.createShape<TLTextShape>({
          id: shapeId,
          type: 'text',
          x: xPosition,
          y: yPosition,
          props: { richText: toRichText('Open question: ') },
        })
      }

      editor.select(shapeId)
      editor.zoomToSelection()
    },
    [editor, isReplayMode],
  )

  const focusNode = useCallback(
    (nodeId: TLShapeId) => {
      if (!editor) return
      editor.select(nodeId)
      editor.zoomToSelection()
      setHighlightedNodeId(nodeId)
      window.setTimeout(() => setHighlightedNodeId((currentNodeId) => (currentNodeId === nodeId ? null : currentNodeId)), 1400)
    },
    [editor],
  )

  const lockSelectedNodes = useCallback(
    (role: UserRole) => {
      if (!editor || isReplayMode) return
      // G3: Only Lead can change lock state
      if (userRole !== 'Lead') {
        setGuardLabel('Only Lead can change locks')
        setGuardFlash(true)
        window.setTimeout(() => setGuardFlash(false), 1200)
        return
      }

      const selectedShapes = editor.getSelectedShapes()
      editor.updateShapes(
        selectedShapes.map((shape) => ({
          id: shape.id,
          type: shape.type,
          meta: withNodeMeta(shape, { lockedToRoles: [role] }),
        })),
      )
      setGuardLabel(`Locked to ${role}`)
      refreshCanvasSnapshot(editor)
    },
    [editor, isReplayMode, refreshCanvasSnapshot, userRole],
  )

  const unlockSelectedNodes = useCallback(() => {
    if (!editor || isReplayMode) return
    // G3: Only Lead can change lock state
    if (userRole !== 'Lead') {
      setGuardLabel('Only Lead can change locks')
      setGuardFlash(true)
      window.setTimeout(() => setGuardFlash(false), 1200)
      return
    }

    const selectedShapes = editor.getSelectedShapes()
    editor.updateShapes(
      selectedShapes.map((shape) => ({
        id: shape.id,
        type: shape.type,
        meta: withNodeMeta(shape, { lockedToRoles: [] }),
      })),
    )
    setGuardLabel('Unlocked selection')
    refreshCanvasSnapshot(editor)
  }, [editor, isReplayMode, refreshCanvasSnapshot, userRole])

  const previewReplayFrame = useCallback(
    (frameIndex: number) => {
      if (!editor) return
      const frame = replayFrames[frameIndex]
      if (!frame) return

      if (!replayLiveSnapshotRef.current) {
        replayLiveSnapshotRef.current = Array.from(liveShapeMapRef.current.values())
      }
      isReplayModeRef.current = true
      setIsReplayMode(true)
      setReplayIndex(frameIndex)
      applyShapeList(editor, frame.shapes)
      setReplayCursors(frame.cursors)
      // Build a temporary snapshot for badges/stats from the historical frame
      const snapshot = buildCanvasSnapshot(editor, eventsRef.current)
      setStats(snapshot.stats)
      setIntentBadges(snapshot.badges)
      setLockBadges(snapshot.locks)
    },
    [editor, replayFrames],
  )

  const restoreLiveCanvas = useCallback(() => {
    if (!editor) {
      setIsReplayMode(false)
      isReplayModeRef.current = false
      return
    }

    const liveShapes = replayLiveSnapshotRef.current
    if (liveShapes) {
      applyShapeList(editor, liveShapes)
      liveShapeMapRef.current = new Map(liveShapes.map((shape) => [shape.id, shape]))
    }
    replayLiveSnapshotRef.current = null
    isReplayModeRef.current = false
    setIsReplayMode(false)
    setIsReplayPlaying(false)
    setReplayCursors({})
    setReplayIndex(Math.max(0, replayFrames.length - 1))
    refreshCanvasSnapshot(editor, false)
  }, [editor, refreshCanvasSnapshot, replayFrames.length])

  const toggleReplayPlayback = useCallback(() => {
    if (!replayFrames.length) return
    if (isReplayPlaying) {
      setIsReplayPlaying(false)
      return
    }
    // If already in replay mode (scrubber is parked at some frame), continue
    // from the current position. Otherwise enter replay from the beginning.
    if (!isReplayMode) {
      previewReplayFrame(0)
    }
    setIsReplayPlaying(true)
  }, [isReplayMode, isReplayPlaying, previewReplayFrame, replayFrames.length])

  // Time-travel the canvas to the exact historical state captured at the moment
  // of a given event — analogous to opening a GitHub commit: every shape that
  // existed at that seq is shown, nothing from after it, nothing from before is
  // missing. After applying the frame we also zoom to the affected node so the
  // user sees exactly what changed.
  const jumpToEventLog = useCallback(
    (event: CanvasEvent) => {
      if (!replayFrames.length) return

      // replayFrames are stored in ascending seq order (index 0 = first ever event).
      // Find the frame whose seq exactly matches this event, or fall back to the
      // largest seq that is still ≤ event.seq.
      let frameIndex = replayFrames.findIndex((f) => f.seq === event.seq)
      if (frameIndex === -1) {
        frameIndex = 0
        for (let i = 0; i < replayFrames.length; i++) {
          if (replayFrames[i]!.seq <= event.seq) frameIndex = i
          else break
        }
      }

      previewReplayFrame(frameIndex)
    },
    [previewReplayFrame, replayFrames],
  )

  const completeOnboarding = useCallback(() => {
    window.localStorage.setItem('ligma.onboardingComplete', 'true')
    setOnboardingStep(onboardingSteps.length)
  }, [])

  const selectedNodeLabel = stats.selectedNodeIds.length
    ? stats.selectedNodeIds.map((nodeId) => nodeId.replace('shape:', '')).join(', ')
    : 'No node selected'
  const activeUserList = Object.values(activeUsers)
  const cursorDisplayMap = isReplayMode ? replayCursors : presenceCursors
  const currentReplayFrame = replayFrames[replayIndex]
  const firstReplayFrame = replayFrames[0]
  const lastReplayFrame = replayFrames[replayFrames.length - 1]
  const visibleOnboardingStep = onboardingStep < onboardingSteps.length ? onboardingSteps[onboardingStep] : null
  const connectionIcon = connectionStatus === 'online' ? Wifi : WifiOff
  const ConnectionIcon = connectionStatus === 'connecting' ? Gauge : connectionIcon
  const isViewOnly = userRole === 'Viewer' || isGuest
  const roleLabel = userRole === 'Lead' ? 'Lead' : userRole === 'Contributor' ? 'Contributor' : 'Viewer'

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="topbar-left">
          {onBackToHome && (
            <button type="button" onClick={onBackToHome} className="ghost-button" title="Back to whiteboards">
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Rooms</span>
            </button>
          )}
          <div className="brand-lockup" aria-label="Ligma workspace">
            <span className="brand-mark">L</span>
            <div>
              <h1>Ligma</h1>
              <p>Live ideation to execution</p>
            </div>
          </div>
        </div>

        <div className="topbar-center">
          <div className="room-controls">
            <label className="room-field">
              <Link2 size={16} aria-hidden="true" />
              <input
                value={roomInput}
                aria-label="Room id"
                onChange={(event) => setRoomInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyRoomChange()
                }}
              />
            </label>
            <button className="icon-button" type="button" title="Join room" onClick={applyRoomChange}>
              <Share2 size={17} aria-hidden="true" />
            </button>
            <button className="ghost-button" type="button" title={shareLabel} onClick={copyRoomLink}>
              <Copy size={16} aria-hidden="true" />
              <span>{shareLabel}</span>
            </button>
            {userRole === 'Lead' && (
              <button
                className="ghost-button"
                type="button"
                title="Create invite link"
                onClick={() => setShowInvite(true)}
              >
                <Users size={16} aria-hidden="true" />
                <span>Invite</span>
              </button>
            )}
          </div>
        </div>

        <div className="topbar-right">
          <div className="identity-controls">
            <div className={`connection-pill ${connectionStatus}`} aria-live="polite">
              <ConnectionIcon size={15} aria-hidden="true" />
              <span>{connectionStatus}</span>
            </div>
            <div className={`ai-status-pill ${aiModelStatus}`} aria-live="polite" title={
              aiModelStatus === 'loading' ? `AI model loading... ${aiModelProgress}%`
                : aiModelStatus === 'ready' ? 'AI classifier ready'
                : 'AI unavailable — using regex'
            }>
              {aiModelStatus === 'loading' ? (
                <><Loader2 size={13} className="ai-spinner" aria-hidden="true" /><span>AI {aiModelProgress}%</span></>
              ) : aiModelStatus === 'ready' ? (
                <><BrainCircuit size={13} aria-hidden="true" /><span>AI</span></>
              ) : (
                <><BrainCircuit size={13} aria-hidden="true" /><span>Regex</span></>
              )}
            </div>
            <label className="name-field">
              <Users size={16} aria-hidden="true" />
              <input value={userName} aria-label="User name" onChange={(event) => setUserName(event.target.value)} />
            </label>
            <div className="swatches" aria-label="Cursor color">
              {USER_COLORS.map((color, colorIndex) => (
                <button
                  className={`swatch swatch-${colorIndex} ${color === userColor ? 'active' : ''}`}
                  key={color}
                  title={color}
                  type="button"
                  onClick={() => setUserColor(color)}
                />
              ))}
            </div>
            <div className={`role-pill ${userRole}`} aria-label="Your role">
              <ShieldAlert size={14} aria-hidden="true" />
              <span>{roleLabel}</span>
            </div>
            {isViewOnly && (
              <div className="view-only-pill" aria-live="polite">
                <Eye size={14} aria-hidden="true" />
                <span>View Only</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className={`canvas-workbench ${isPanelCollapsed ? 'panel-collapsed' : ''}`}>
        <aside className="left-rail" aria-label="Canvas tools">
          <ToolButton icon={MousePointer2} label="Select" onClick={() => setTool('select')} />
          <ToolButton icon={Hand} label="Pan" onClick={() => setTool('hand')} />
          <ToolButton icon={StickyNote} label="Sticky" onClick={() => createNode('action-note')} disabled={isViewOnly} />
          <ToolButton icon={PenLine} label="Draw" onClick={() => setTool('draw')} disabled={isViewOnly} />
          <ToolButton icon={Square} label="Shape" onClick={() => setTool('geo')} disabled={isViewOnly} />
          <ToolButton icon={Type} label="Text" onClick={() => setTool('text')} disabled={isViewOnly} />
          <div className="rail-divider" />
          <ToolButton icon={ClipboardList} label="Action node" onClick={() => createNode('action-note')} disabled={isViewOnly} />
          <ToolButton icon={Diamond} label="Decision node" onClick={() => createNode('decision-shape')} disabled={isViewOnly} />
          <ToolButton icon={MessageSquareText} label="Question node" onClick={() => createNode('question-text')} disabled={isViewOnly} />
          <div className="rail-divider" />
          <ToolButton
            icon={isEditBarVisible ? ChevronDown : ChevronUp}
            label={isEditBarVisible ? 'Hide edit bar' : 'Show edit bar'}
            onClick={() => setIsEditBarVisible((visible) => !visible)}
          />
        </aside>

        <div className={`canvas-stage ${isEditBarVisible ? '' : 'editbar-hidden'}`} ref={canvasStageRef}>
          <div className="canvas-status" aria-live="polite">
            <span className={`status-dot ${connectionStatus}`} />
            <span>{connectionStatus === 'online' ? 'custom websocket' : connectionStatus}</span>
            <span>{roomId}</span>
          </div>

          {isViewOnly && (
            <div className="view-only-banner" aria-live="polite">
              <ShieldAlert size={16} aria-hidden="true" />
              <span>Read-only mode — you are viewing as <strong>{isGuest ? 'Guest' : userRole}</strong></span>
            </div>
          )}
          <Tldraw
            autoFocus
            inferDarkMode={false}
            initialState="select"
            onMount={(mountedEditor) => {
              setEditor(mountedEditor)
              refreshCanvasSnapshot(mountedEditor, false)
            }}
            user={tldrawUser}
          />

          <svg className="presence-layer" aria-hidden="true">
            {Object.values(cursorDisplayMap).map((cursor) => {
              if (!editor) return null
              const viewportPoint = editor.pageToViewport({ x: cursor.x, y: cursor.y })
              return (
                <g key={cursor.sessionId} transform={`translate(${viewportPoint.x} ${viewportPoint.y})`}>
                  <path d="M0 0 0 24 7 17 12 28 17 26 12 15 22 15Z" fill={cursor.color} />
                  <rect x="16" y="10" width="148" height="24" rx="7" fill={cursor.color} />
                  <text x="26" y="27" fill="#ffffff">
                    {cursor.name} / {cursor.role}
                  </text>
                </g>
              )
            })}
          </svg>

          <AnimatePresence>
            {intentBadges.map((badge, badgeIndex) => (
              <motion.button
                animate={{ opacity: 1, scale: [0.94, 1.04, 1] }}
                className={`intent-badge ${badge.intent}`}
                exit={{ opacity: 0, scale: 0.92 }}
                initial={{ opacity: 0, scale: 0.86 }}
                key={`${badge.nodeId}-${badge.intent}-${badgeIndex}`}
                onClick={() => focusNode(badge.nodeId)}
                style={{ left: badge.x, top: badge.y }}
                title={badge.label}
                transition={{ duration: 0.5, repeat: badge.intent === 'action' ? 1 : 0 }}
                type="button"
              >
                {badge.label}
              </motion.button>
            ))}
          </AnimatePresence>

          <AnimatePresence>
            {lockBadges.map((lock, lockIndex) => (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="lock-badge"
                exit={{ opacity: 0, y: 4 }}
                initial={{ opacity: 0, y: 4 }}
                key={`lock-${lock.nodeId}-${lockIndex}`}
                style={{ left: lock.x, top: lock.y }}
                title={lock.label}
                transition={{ duration: 0.3 }}
              >
                {lock.label}
              </motion.div>
            ))}
          </AnimatePresence>

          <AnimatePresence>
            {highlightedNodeId && (
              <motion.div
                animate={{ opacity: [0, 1, 0], scale: [0.86, 1.18, 1.45] }}
                className="node-highlight-pulse"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0, scale: 0.8 }}
                key={highlightedNodeId}
                transition={{ duration: 1.2 }}
              />
            )}
          </AnimatePresence>

          <section className={`replay-bar ${isReplayMode ? 'scrubbing' : ''}`} aria-label="Time travel replay">
            <div className="replay-title">
              <TimerReset size={15} aria-hidden="true" />
              <span>{replayFrames.length} events</span>
              <small>{currentReplayFrame ? `${formatTime(currentReplayFrame.at)} / ${currentReplayFrame.label}` : 'Live canvas'}</small>
            </div>
            <div className="replay-scrubber-wrap">
              <input
                aria-label="Replay timeline"
                disabled={!replayFrames.length}
                max={Math.max(0, replayFrames.length - 1)}
                min={0}
                onChange={(event) => previewReplayFrame(Number(event.target.value))}
                type="range"
                value={Math.min(replayIndex, Math.max(0, replayFrames.length - 1))}
              />
              {replayFrames.length > 1 && (
                <div className="replay-range-labels">
                  <span>{firstReplayFrame ? formatTime(firstReplayFrame.at) : ''}</span>
                  <span>{lastReplayFrame ? formatTime(lastReplayFrame.at) : ''}</span>
                </div>
              )}
            </div>
            <div className="replay-controls">
              <button type="button" title="Play replay" onClick={toggleReplayPlayback}>
                {isReplayPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              </button>
              {[1, 2, 4].map((speed) => (
                <button
                  className={speed === replaySpeed ? 'active' : ''}
                  key={speed}
                  type="button"
                  onClick={() => setReplaySpeed(speed)}
                >
                  {speed}x
                </button>
              ))}
              {isReplayMode && (
                <button type="button" title="Return to live" onClick={restoreLiveCanvas}>
                  Live
                </button>
              )}
            </div>
          </section>

          {isEditBarVisible && (
            <button
              className="editbar-close"
              type="button"
              title="Hide edit bar"
              onClick={() => setIsEditBarVisible(false)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}

          <AnimatePresence>
            {visibleOnboardingStep && (
              <motion.section
                animate={{ opacity: 1, y: 0 }}
                className={`onboarding-card step-${onboardingStep}`}
                exit={{ opacity: 0, y: 8 }}
                initial={{ opacity: 0, y: 8 }}
              >
                <button className="tour-close" type="button" title="Dismiss tour" onClick={completeOnboarding}>
                  <X size={14} aria-hidden="true" />
                </button>
                <small>
                  {onboardingStep + 1} / {onboardingSteps.length}
                </small>
                <h2>{visibleOnboardingStep.title}</h2>
                <p>{visibleOnboardingStep.body}</p>
                <button
                  className="tour-next"
                  type="button"
                  onClick={() => {
                    if (onboardingStep + 1 >= onboardingSteps.length) completeOnboarding()
                    else setOnboardingStep((step) => step + 1)
                  }}
                >
                  {onboardingStep + 1 >= onboardingSteps.length ? 'Done' : 'Next'}
                </button>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        <button
          className="panel-edge-toggle"
          type="button"
          title={isPanelCollapsed ? 'Open panel' : 'Collapse panel'}
          aria-label={isPanelCollapsed ? 'Open panel' : 'Collapse panel'}
          onClick={() => setIsPanelCollapsed((isCollapsed) => !isCollapsed)}
        >
          {isPanelCollapsed ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>

        <aside className={`right-panel ${isPanelCollapsed ? 'collapsed' : ''}`} aria-label="Execution panel">
          <section className="panel-section panel-toggle-section">
            <button className="panel-toggle" type="button" onClick={() => setIsPanelCollapsed((isCollapsed) => !isCollapsed)}>
              {isPanelCollapsed ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              <span>{isPanelCollapsed ? `${tasks.length} tasks · ${events.length} events` : 'Collapse panel'}</span>
            </button>
          </section>

          <section className="panel-section compact-metrics">
            <Metric icon={Circle} label="Nodes" value={stats.nodeCount} />
            <Metric icon={ClipboardList} label="Tasks" value={tasks.length} />
            <Metric icon={Diamond} label="Decisions" value={stats.decisionCount} />
            <Metric icon={MessageSquareText} label="Questions" value={stats.questionCount} />
          </section>

          <section className="panel-section presence-roster">
            <div className="section-heading">
              <Users size={16} aria-hidden="true" />
              <h2>Room Presence</h2>
            </div>
            <div className="avatar-stack">
              {activeUserList.map((user) => (
                <span className={`avatar avatar-${getColorIndex(user.color)}`} key={user.sessionId} title={`${user.name} / ${user.role}`}>
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
          </section>

          <section className="panel-section selected-node">
            <div className="section-heading">
              <FileText size={16} aria-hidden="true" />
              <h2>Node</h2>
            </div>
            <p className="node-id">{selectedNodeLabel}</p>
            {userRole === 'Lead' && (
              <div className="lock-controls">
                <button type="button" onClick={() => lockSelectedNodes('Lead')} disabled={!stats.selectedNodeIds.length || isReplayMode}>
                  <LockKeyhole size={15} aria-hidden="true" />
                  <span>Lead</span>
                </button>
                <button
                  type="button"
                  onClick={() => lockSelectedNodes('Contributor')}
                  disabled={!stats.selectedNodeIds.length || isReplayMode}
                >
                  <LockKeyhole size={15} aria-hidden="true" />
                  <span>Contributor</span>
                </button>
                <button type="button" onClick={unlockSelectedNodes} disabled={!stats.selectedNodeIds.length || isReplayMode}>
                  <UnlockKeyhole size={15} aria-hidden="true" />
                  <span>Unlock</span>
                </button>
              </div>
            )}
            <small className={guardFlash ? 'guard-flash' : ''}>{guardLabel}</small>
          </section>

          <section className="panel-section task-board">
            <div className="section-heading">
              <Sparkles size={16} aria-hidden="true" />
              <h2>Task Board</h2>
              <span className="ai-powered-badge" title={aiModelStatus === 'ready' ? 'Classified by AI' : 'Classified by regex'}>
                <BrainCircuit size={10} aria-hidden="true" />
                {aiModelStatus === 'ready' ? 'AI-powered' : 'Regex'}
              </span>
              {connectionStatus === 'online' && (
                <span className="live-sync-dot" title="Synced live across all users">
                  <span className="live-sync-pulse" />
                  Live
                </span>
              )}
            </div>
            <div className="task-list">
              {tasks.length ? (
                tasks.map((task, taskIndex) => (
                  <button
                    className="task-row"
                    key={`${task.nodeId}-${task.createdAt}-${taskIndex}`}
                    type="button"
                    onClick={() => focusNode(task.nodeId)}
                  >
                    <span className={`task-avatar avatar-${task.authorColorIndex}`}>{task.authorName.slice(0, 1).toUpperCase()}</span>
                    <span className="task-intent">{intentCopy[task.intent]}</span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.authorName} / {task.authorRole} / {formatTimestamp(task.createdAt)}
                    </small>
                  </button>
                ))
              ) : (
                <p className="empty-state">No action items yet</p>
              )}
            </div>
          </section>

          <section className="panel-section ai-summary-section">
            <div className="section-heading">
              <BrainCircuit size={16} aria-hidden="true" />
              <h2>AI Summary</h2>
            </div>
            <button
              className="summary-export-button"
              type="button"
              onClick={generateAISummary}
              disabled={summaryGenerating || isReplayMode}
            >
              {summaryGenerating ? (
                <><Loader2 size={15} className="ai-spinner" aria-hidden="true" /><span>Generating...</span></>
              ) : (
                <><Download size={15} aria-hidden="true" /><span>Export AI Summary</span></>
              )}
            </button>
            <p className="summary-hint">One-click structured brief of your brainstorm</p>
          </section>

          <section className="panel-section event-log">
            <div className="section-heading">
              <Activity size={16} aria-hidden="true" />
              <h2>Event Log</h2>
              <span className="append-only-badge" title="Events are immutable — append-only">
                <LockKeyhole size={10} aria-hidden="true" />
                Append-only
              </span>
            </div>
            <div className="event-list" ref={eventListRef}>
              {events.length ? (
                events.map((event) => (
                  <button
                    className={`event-row ${event.operation}${isReplayMode && currentReplayFrame?.seq === event.seq ? ' replay-active' : ''}`}
                    key={event.id}
                    type="button"
                    title="Click to time-travel canvas to this moment"
                    onClick={() => jumpToEventLog(event)}
                  >
                    <span>{event.operation}</span>
                    <strong>{event.label}</strong>
                    <small>
                      #{event.seq} / {event.authorName} / {formatTime(event.at)}
                    </small>
                  </button>
                ))
              ) : (
                <p className="empty-state">Waiting for canvas events</p>
              )}
            </div>
          </section>
        </aside>
      </section>
      {showInvite && (
        <InviteModal room_id={roomId} onClose={() => setShowInvite(false)} />
      )}
      {showSummaryModal && (
        <div className="summary-modal-overlay" onClick={() => setShowSummaryModal(false)}>
          <div className="summary-modal" onClick={(e) => e.stopPropagation()}>
            <div className="summary-modal-header">
              <div className="summary-modal-title">
                <BrainCircuit size={20} aria-hidden="true" />
                <h2>AI Summary Export</h2>
              </div>
              <button className="summary-modal-close" type="button" onClick={() => setShowSummaryModal(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="summary-modal-actions">
              <button
                type="button"
                className="summary-action-button"
                onClick={async () => {
                  const ok = await copyToClipboard(summaryContent)
                  if (ok) {
                    const btn = document.querySelector('.summary-action-button') as HTMLElement
                    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = ''; }, 1200) }
                  }
                }}
              >
                <Copy size={15} aria-hidden="true" />
                <span>Copy to clipboard</span>
              </button>
              <button
                type="button"
                className="summary-action-button"
                onClick={() => downloadMarkdown(summaryContent, `ligma-summary-${roomId}.md`)}
              >
                <Download size={15} aria-hidden="true" />
                <span>Download .md</span>
              </button>
            </div>
            <pre className="summary-modal-content">{summaryContent}</pre>
          </div>
        </div>
      )}
      {roomError && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(185, 28, 28, 0.95)',
            color: 'white',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            zIndex: 200,
          }}
          onClick={() => clearRoomError?.()}
        >
          {roomError} (click to dismiss)
        </div>
      )}
    </main>
  )
}

function ToolButton({ icon: Icon, label, onClick, disabled }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="tool-button" type="button" title={label} onClick={onClick} disabled={disabled}>
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="metric">
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default App
