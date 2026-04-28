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
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Copy,
  Diamond,
  FileText,
  Gauge,
  Hand,
  Link2,
  LockKeyhole,
  MessageSquareText,
  MousePointer2,
  Pause,
  PenLine,
  Play,
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

type CanvasEvent = {
  id: string
  at: string
  authorName: string
  authorRole: UserRole
  label: string
  nodeId?: string
  operation: 'created' | 'updated' | 'deleted'
  seq: number
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
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

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

function getSyncUrl() {
  const configuredUrl = import.meta.env.VITE_LIGMA_SYNC_URL as string | undefined
  if (configuredUrl) {
    return appendToken(configuredUrl)
  }

  // Default: same-origin /ligma-sync (Vite proxies it in dev; Fastify serves
  // it in prod). The JWT is appended as ?token=... per our gateway contract.
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${protocol}://${window.location.host}/ligma-sync`
  return appendToken(url)
}

function appendToken(url: string): string {
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

function classifyIntent(text: string): Intent {
  const lowerText = text.toLowerCase()

  if (/\b(todo|action|assign|owner|follow up|next step|ship|build|fix|create|implement)\b/.test(lowerText)) {
    return 'action'
  }

  if (/\b(decision|decided|approved|chosen|final|agree|agreed)\b/.test(lowerText)) {
    return 'decision'
  }

  if (text.includes('?') || /\b(question|unknown|open|clarify|risk)\b/.test(lowerText)) {
    return 'question'
  }

  return 'reference'
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

function buildCanvasSnapshot(editor: Editor, events: CanvasEvent[]) {
  const shapes = editor.getCurrentPageShapes()
  const tasks: CanvasTask[] = []
  const badges: CanvasIntentBadge[] = []
  const seenShapeIds = new Set<TLShapeId>()
  let actionCount = 0
  let decisionCount = 0
  let questionCount = 0

  for (const shape of shapes) {
    if (seenShapeIds.has(shape.id)) continue
    seenShapeIds.add(shape.id)

    const text = getShapeText(editor, shape)

    if (!text) {
      continue
    }

    const intent = classifyIntent(text)
    const nodeMeta = readNodeMeta(shape)
    const bounds = editor.getShapePageBounds(shape.id)

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
}

function App({ onBackToHome, roomError, clearRoomError }: AppProps = {}) {
  const [roomId, setRoomId] = useState(readSearchRoomId)
  const [showInvite, setShowInvite] = useState(false)
  const [roomInput, setRoomInput] = useState(roomId)
  const [userName, setUserName] = useState(() => getStoredValue('ligma.userName', 'DevDay Lead'))
  const [userColor, setUserColor] = useState(() => getStoredValue('ligma.userColor', USER_COLORS[0]))
  const [userRole, setUserRole] = useState<UserRole>(readStoredRole)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [events, setEvents] = useState<CanvasEvent[]>([])
  const [tasks, setTasks] = useState<CanvasTask[]>([])
  const [intentBadges, setIntentBadges] = useState<CanvasIntentBadge[]>([])
  const [stats, setStats] = useState<CanvasStats>(EMPTY_STATS)
  const [shareLabel, setShareLabel] = useState('Copy room link')
  const [guardLabel, setGuardLabel] = useState('Node access ready')
  const [presenceCursors, setPresenceCursors] = useState<Record<string, PresenceCursor>>({})
  const [activeUsers, setActiveUsers] = useState<Record<string, ActiveUser>>({})
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [highlightedNodeId, setHighlightedNodeId] = useState<TLShapeId | null>(null)
  const [onboardingStep, setOnboardingStep] = useState(() =>
    window.localStorage.getItem('ligma.onboardingComplete') === 'true' ? onboardingSteps.length : 0,
  )
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([])
  const [replayIndex, setReplayIndex] = useState(0)
  const [isReplayMode, setIsReplayMode] = useState(false)
  const [isReplayPlaying, setIsReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
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
  // Snapshot of live shapes captured the moment replay started; used to restore live canvas.
  const replayLiveSnapshotRef = useRef<TLShape[] | null>(null)
  const isReplayModeRef = useRef(false)
  // Timer refs for debouncing expensive operations during high-frequency store updates
  const snapshotTimerRef = useRef<number | null>(null)
  const badgeRafRef = useRef<number | null>(null)
  const presenceSessionId = useMemo(() => safeRandomUUID(), [])
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

  const sendSocketMessage = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }, [])

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
      const snapshot = buildCanvasSnapshot(activeEditor, eventsRef.current)
      setStats(snapshot.stats)
      setIntentBadges(snapshot.badges)
      if (shouldPublishTasks && !isReplayModeRef.current) {
        publishTasksToYjs(snapshot.tasks)
      }
    },
    [publishTasksToYjs],
  )

  const appendEvents = useCallback((incomingEvents: CanvasEvent[], liveShapesForFrame?: TLShape[] | null) => {
    if (!incomingEvents.length) return

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

    // Use the supplied live shape list (always reflects post-event live state, even when the
    // user is scrubbing through history). Falls back to the editor when not provided.
    const frameShapes =
      liveShapesForFrame ?? Array.from(liveShapeMapRef.current.values())
    const frameEvent = incomingEvents[incomingEvents.length - 1]
    const frame: ReplayFrame = {
      at: frameEvent.at,
      label: frameEvent.label,
      operation: frameEvent.operation,
      seq: newestSeq,
      shapes: frameShapes.map((shape) => ({ ...shape })),
    }
    setReplayFrames((currentFrames) => [...currentFrames, frame].slice(-160))
  }, [])

  const applyWelcome = useCallback(
    (message: WelcomeMessage, activeEditor: Editor) => {
      applyShapeList(activeEditor, message.shapes ?? [])
      liveShapeMapRef.current = new Map((message.shapes ?? []).map((shape) => [shape.id, shape]))

      if (message.taskUpdate?.length) {
        Y.applyUpdate(taskDoc, Uint8Array.from(message.taskUpdate), REMOTE_YJS_ORIGIN)
      }

      const welcomeEvents = (message.events ?? []).map((event) => ({ ...event, authorRole: sanitizeRole(event.authorRole) }))
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
      setReplayFrames([
        {
          at: new Date(message.serverTime).toISOString(),
          label: 'Joined live room',
          operation: 'updated',
          seq: lastEventSeqRef.current,
          shapes: (message.shapes ?? []).map((shape) => ({ ...shape })),
        },
      ])
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
      const socket = new WebSocket(getSyncUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        setConnectionStatus('online')
        sendSocketMessage({
          color: userColor,
          lastEventSeq: lastEventSeqRef.current,
          name: userName,
          role: userRole,
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
          }))
          appendEvents(serverEvents, Array.from(liveShapeMapRef.current.values()))
          if (!isReplayModeRef.current) {
            refreshCanvasSnapshot(activeEditor, false)
          }
          return
        }

        if (message.type === 'mutation-rejected') {
          setGuardLabel(message.rejected?.map((item) => item.reason).join(' / ') || 'Mutation rejected')
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
  }, [appendEvents, applyWelcome, presenceSessionId, refreshCanvasSnapshot, roomId, sendSocketMessage, taskDoc, userColor, userName, userRole])

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
          sendSocketMessage({ delta, type: 'canvas-delta' })
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
    if (!isReplayPlaying || !editor || replayFrames.length <= 1) return

    const interval = window.setInterval(() => {
      setReplayIndex((currentIndex) => {
        const nextIndex = Math.min(currentIndex + 1, replayFrames.length - 1)
        const frame = replayFrames[nextIndex]

        if (frame) {
          if (!replayLiveSnapshotRef.current) {
            replayLiveSnapshotRef.current = Array.from(liveShapeMapRef.current.values())
          }
          isReplayModeRef.current = true
          setIsReplayMode(true)
          applyShapeList(editor, frame.shapes)
        }

        if (nextIndex >= replayFrames.length - 1) {
          setIsReplayPlaying(false)
        }

        return nextIndex
      })
    }, Math.max(180, 900 / replaySpeed))

    return () => window.clearInterval(interval)
  }, [editor, isReplayPlaying, replayFrames, replaySpeed])

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
    lastEventSeqRef.current = 0
  }, [roomInput, taskArray, taskDoc])

  const copyRoomLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href)
    setShareLabel('Copied')
    window.setTimeout(() => setShareLabel('Copy room link'), 1200)
  }, [])

  const setTool = useCallback(
    (toolId: string) => {
      editor?.setCurrentTool(toolId)
    },
    [editor],
  )

  const createNode = useCallback(
    (type: 'action-note' | 'decision-shape' | 'question-text') => {
      if (!editor || isReplayMode) return

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
    [editor, isReplayMode, refreshCanvasSnapshot],
  )

  const unlockSelectedNodes = useCallback(() => {
    if (!editor || isReplayMode) return

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
  }, [editor, isReplayMode, refreshCanvasSnapshot])

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
      // Build a temporary snapshot for badges/stats from the historical frame
      const snapshot = buildCanvasSnapshot(editor, eventsRef.current)
      setStats(snapshot.stats)
      setIntentBadges(snapshot.badges)
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
    setReplayIndex(Math.max(0, replayFrames.length - 1))
    refreshCanvasSnapshot(editor, false)
  }, [editor, refreshCanvasSnapshot, replayFrames.length])

  const completeOnboarding = useCallback(() => {
    window.localStorage.setItem('ligma.onboardingComplete', 'true')
    setOnboardingStep(onboardingSteps.length)
  }, [])

  const selectedNodeLabel = stats.selectedNodeIds.length
    ? stats.selectedNodeIds.map((nodeId) => nodeId.replace('shape:', '')).join(', ')
    : 'No node selected'
  const activeUserList = Object.values(activeUsers)
  const currentReplayFrame = replayFrames[replayIndex]
  const visibleOnboardingStep = onboardingStep < onboardingSteps.length ? onboardingSteps[onboardingStep] : null
  const connectionIcon = connectionStatus === 'online' ? Wifi : WifiOff
  const ConnectionIcon = connectionStatus === 'connecting' ? Gauge : connectionIcon

  return (
    <main className="workspace-shell">
      <header className="topbar">
        {onBackToHome && (
          <button
            type="button"
            onClick={onBackToHome}
            className="ghost-button"
            title="Back to whiteboards"
            style={{ marginRight: 6 }}
          >
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

        <div className="identity-controls">
          <div className={`connection-pill ${connectionStatus}`} aria-live="polite">
            <ConnectionIcon size={15} aria-hidden="true" />
            <span>{connectionStatus}</span>
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
          <div className="segmented" aria-label="Role">
            {ROLES.map((role) => (
              <button
                className={role === userRole ? 'active' : ''}
                key={role}
                type="button"
                onClick={() => setUserRole(role)}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className={`canvas-workbench ${isPanelCollapsed ? 'panel-collapsed' : ''}`}>
        <aside className="left-rail" aria-label="Canvas tools">
          <ToolButton icon={MousePointer2} label="Select" onClick={() => setTool('select')} />
          <ToolButton icon={Hand} label="Pan" onClick={() => setTool('hand')} />
          <ToolButton icon={StickyNote} label="Sticky" onClick={() => createNode('action-note')} />
          <ToolButton icon={PenLine} label="Draw" onClick={() => setTool('draw')} />
          <ToolButton icon={Square} label="Shape" onClick={() => setTool('geo')} />
          <ToolButton icon={Type} label="Text" onClick={() => setTool('text')} />
          <div className="rail-divider" />
          <ToolButton icon={ClipboardList} label="Action node" onClick={() => createNode('action-note')} />
          <ToolButton icon={Diamond} label="Decision node" onClick={() => createNode('decision-shape')} />
          <ToolButton icon={MessageSquareText} label="Question node" onClick={() => createNode('question-text')} />
        </aside>

        <div className="canvas-stage" ref={canvasStageRef}>
          <div className="canvas-status" aria-live="polite">
            <span className={`status-dot ${connectionStatus}`} />
            <span>{connectionStatus === 'online' ? 'custom websocket' : connectionStatus}</span>
            <span>{roomId}</span>
          </div>
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
            {Object.values(presenceCursors).map((cursor) => {
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
            <input
              aria-label="Replay timeline"
              disabled={!replayFrames.length}
              max={Math.max(0, replayFrames.length - 1)}
              min={0}
              onChange={(event) => previewReplayFrame(Number(event.target.value))}
              type="range"
              value={Math.min(replayIndex, Math.max(0, replayFrames.length - 1))}
            />
            <div className="replay-controls">
              <button type="button" title="Play replay" onClick={() => setIsReplayPlaying((isPlaying) => !isPlaying)}>
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

        <aside className={`right-panel ${isPanelCollapsed ? 'collapsed' : ''}`} aria-label="Execution panel">
          <section className="panel-section panel-toggle-section">
            <button className="panel-toggle" type="button" onClick={() => setIsPanelCollapsed((isCollapsed) => !isCollapsed)}>
              {isPanelCollapsed ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              <span>{isPanelCollapsed ? stats.actionCount : 'Collapse panel'}</span>
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
            <small>{guardLabel}</small>
          </section>

          <section className="panel-section task-board">
            <div className="section-heading">
              <Sparkles size={16} aria-hidden="true" />
              <h2>Task Board</h2>
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
                      {task.authorName} / {task.authorRole} / {formatTime(task.createdAt)}
                    </small>
                  </button>
                ))
              ) : (
                <p className="empty-state">No action items yet</p>
              )}
            </div>
          </section>

          <section className="panel-section event-log">
            <div className="section-heading">
              <Activity size={16} aria-hidden="true" />
              <h2>Event Log</h2>
            </div>
            <div className="event-list">
              {events.length ? (
                events.map((event) => (
                  <button
                    className={`event-row ${event.operation}`}
                    key={event.id}
                    type="button"
                    onClick={() => event.nodeId && focusNode(event.nodeId as TLShapeId)}
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

function ToolButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button className="tool-button" type="button" title={label} onClick={onClick}>
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
