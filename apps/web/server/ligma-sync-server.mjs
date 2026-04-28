import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'

const port = Number(process.env.LIGMA_SYNC_PORT ?? 8787)
const path = process.env.LIGMA_SYNC_PATH ?? '/ligma-sync'

/** @type {Map<string, RoomState>} */
const rooms = new Map()

/**
 * @typedef {{ sessionId: string, name: string, color: string, role: 'Lead' | 'Contributor' | 'Viewer', socket: import('ws').WebSocket }} ClientState
 * @typedef {{ clients: Map<string, ClientState>, events: SyncEvent[], seq: number, shapes: Map<string, any>, taskDoc: Y.Doc }} RoomState
 * @typedef {{ id: string, seq: number, at: string, label: string, nodeId?: string, operation: 'created' | 'updated' | 'deleted', source: 'remote' | 'user', authorName: string, authorRole: string }} SyncEvent
 */

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: false }))
})

const wss = new WebSocketServer({ server, path })

function getRoom(roomId) {
  const normalizedRoomId = String(roomId || 'ligma-devday-main')

  if (!rooms.has(normalizedRoomId)) {
    rooms.set(normalizedRoomId, {
      clients: new Map(),
      events: [],
      seq: 0,
      shapes: new Map(),
      taskDoc: new Y.Doc(),
    })
  }

  return rooms.get(normalizedRoomId)
}

function parseMessage(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString())
  } catch {
    return null
  }
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function broadcast(room, message) {
  for (const client of room.clients.values()) {
    send(client.socket, message)
  }
}

function sanitizeRole(role) {
  return role === 'Lead' || role === 'Contributor' || role === 'Viewer' ? role : 'Viewer'
}

function isShapeRecord(record) {
  return Boolean(record && typeof record === 'object' && record.typeName === 'shape' && typeof record.id === 'string')
}

function readNodeMeta(shape) {
  const meta = shape?.meta?.ligma

  if (!meta || typeof meta !== 'object') {
    return { lockedToRoles: [] }
  }

  return {
    ...meta,
    lockedToRoles: Array.isArray(meta.lockedToRoles) ? meta.lockedToRoles : [],
  }
}

function canMutateShape(shape, role) {
  const nodeMeta = readNodeMeta(shape)
  return !nodeMeta.lockedToRoles.length || nodeMeta.lockedToRoles.includes(role)
}

function describeShape(shape) {
  if (shape?.type === 'note') return 'sticky note'
  if (shape?.type === 'draw') return 'freehand drawing'
  if (shape?.type === 'text') return 'text block'
  if (shape?.type === 'geo') return 'shape'
  return shape?.type ?? 'node'
}

function createEvent(room, operation, shape, client) {
  room.seq += 1

  const event = {
    id: `evt-${room.seq}-${shape.id}-${operation}`,
    seq: room.seq,
    at: new Date().toISOString(),
    label: `${operation[0].toUpperCase()}${operation.slice(1)} ${describeShape(shape)}`,
    nodeId: shape.id,
    operation,
    source: 'remote',
    authorName: client.name,
    authorRole: client.role,
  }

  room.events.push(event)

  if (room.events.length > 500) {
    room.events.splice(0, room.events.length - 500)
  }

  return event
}

function normalizeDelta(delta) {
  return {
    added: delta?.added && typeof delta.added === 'object' ? delta.added : {},
    removed: delta?.removed && typeof delta.removed === 'object' ? delta.removed : {},
    updated: delta?.updated && typeof delta.updated === 'object' ? delta.updated : {},
  }
}

function validateAndApplyDelta(room, client, incomingDelta) {
  const delta = normalizeDelta(incomingDelta)
  const acceptedDelta = { added: {}, removed: {}, updated: {} }
  const events = []
  const rejected = []

  for (const shape of Object.values(delta.added)) {
    if (!isShapeRecord(shape)) continue

    room.shapes.set(shape.id, shape)
    acceptedDelta.added[shape.id] = shape
    events.push(createEvent(room, 'created', shape, client))
  }

  for (const entry of Object.values(delta.updated)) {
    const previousShape = Array.isArray(entry) ? entry[0] : undefined
    const nextShape = Array.isArray(entry) ? entry[1] : entry

    if (!isShapeRecord(nextShape)) continue


    const storedShape = room.shapes.get(nextShape.id) ?? previousShape ?? nextShape


    if (!canMutateShape(storedShape, client.role)) {
      rejected.push({ id: nextShape.id, reason: `Locked to ${readNodeMeta(storedShape).lockedToRoles.join(', ')}` })
      continue
    }

    room.shapes.set(nextShape.id, nextShape)
    acceptedDelta.updated[nextShape.id] = [storedShape, nextShape]
    events.push(createEvent(room, 'updated', nextShape, client))
  }

  for (const shape of Object.values(delta.removed)) {
    if (!isShapeRecord(shape)) continue

    const storedShape = room.shapes.get(shape.id) ?? shape

    if (!canMutateShape(storedShape, client.role)) {
      rejected.push({ id: shape.id, reason: `Locked to ${readNodeMeta(storedShape).lockedToRoles.join(', ')}` })
      continue
    }

    room.shapes.delete(shape.id)
    acceptedDelta.removed[shape.id] = storedShape
    events.push(createEvent(room, 'deleted', storedShape, client))
  }

  return { acceptedDelta, events, rejected }
}

wss.on('connection', (socket) => {
  /** @type {RoomState | null} */
  let room = null
  /** @type {ClientState | null} */
  let client = null
  let roomId = ''

  socket.on('message', (rawMessage) => {
    const message = parseMessage(rawMessage)
    if (!message || typeof message.type !== 'string') return

    if (message.type === 'hello') {
      roomId = String(message.roomId || 'ligma-devday-main')
      room = getRoom(roomId)
      client = {
        color: typeof message.color === 'string' ? message.color : '#0ea5e9',
        name: typeof message.name === 'string' ? message.name.slice(0, 80) : 'Anonymous',
        role: sanitizeRole(message.role),
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : crypto.randomUUID(),
        socket,
      }

      room.clients.set(client.sessionId, client)

      send(socket, {
        type: 'sync-welcome',
        roomId,
        serverTime: Date.now(),
        senderSessionId: 'server',
        shapes: Array.from(room.shapes.values()),
        events: room.events.filter((event) => event.seq > Number(message.lastEventSeq ?? 0)),
        taskUpdate: Array.from(Y.encodeStateAsUpdate(room.taskDoc)),
        users: Array.from(room.clients.values()).map(({ color, name, role, sessionId }) => ({
          color,
          name,
          role,
          sessionId,
        })),
      })

      broadcast(room, {
        type: 'presence-user',
        phase: 'join',
        sessionId: client.sessionId,
        name: client.name,
        color: client.color,
        role: client.role,
      })
      return
    }

    if (!room || !client) return

    if (message.type === 'canvas-delta') {
      const { acceptedDelta, events, rejected } = validateAndApplyDelta(room, client, message.delta)
      const hasAcceptedChanges = events.length > 0

      if (hasAcceptedChanges) {
        broadcast(room, {
          type: 'canvas-delta',
          roomId,
          senderSessionId: client.sessionId,
          delta: acceptedDelta,
          events,
        })
      }

      if (rejected.length) {
        send(socket, { type: 'mutation-rejected', roomId, rejected })
      }

      return
    }

    if (message.type === 'presence-cursor') {
      broadcast(room, {
        type: 'presence-cursor',
        sessionId: client.sessionId,
        name: client.name,
        color: client.color,
        role: client.role,
        x: Number(message.x) || 0,
        y: Number(message.y) || 0,
      })
      return
    }

    if (message.type === 'yjs-update' && Array.isArray(message.update)) {
      const update = Uint8Array.from(message.update)
      Y.applyUpdate(room.taskDoc, update, client.sessionId)

      broadcast(room, {
        type: 'yjs-update',
        roomId,
        senderSessionId: client.sessionId,
        update: message.update,
      })
    }
  })

  socket.on('close', () => {
    if (!room || !client) return

    room.clients.delete(client.sessionId)
    broadcast(room, { type: 'presence-user', phase: 'leave', sessionId: client.sessionId })
  })
})

server.listen(port, () => {
  console.log(`Ligma sync server listening on ws://localhost:${port}${path}`)
})