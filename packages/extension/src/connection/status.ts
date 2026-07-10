export type ConnectionKind =
  | 'external'
  | 'embedded'
  | 'starting'
  | 'incompatible'
  | 'unavailable'
  | null

export interface CachedConnection {
  url: string
  kind: ConnectionKind
  timestamp: number
}

type StatusListener = (cwd: string, kind: ConnectionKind) => void

const statusListeners = new Set<StatusListener>()
const unavailableReason = new Map<string, string>()
const incompatibleBridge = new Map<string, string>()
export const connectionCache = new Map<string, CachedConnection>()

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function emitStatusChange(cwd: string, kind: ConnectionKind): void {
  for (const listener of statusListeners) {
    try {
      listener(cwd, kind)
    } catch {
      // Status updates are best-effort; stale UI subscribers should not break process events.
    }
  }
}

export function markUnavailable(cwd: string, message: string): void {
  unavailableReason.set(cwd, message)
}

export function clearUnavailable(cwd: string): void {
  unavailableReason.delete(cwd)
}

export function getUnavailableReason(cwd: string): string | undefined {
  return unavailableReason.get(cwd)
}

export function markIncompatibleBridge(cwd: string, message: string): void {
  incompatibleBridge.set(cwd, message)
}

export function clearIncompatibleBridge(cwd: string): void {
  incompatibleBridge.delete(cwd)
}

export function getIncompatibleBridge(cwd: string): string | undefined {
  return incompatibleBridge.get(cwd)
}

export function invalidateCache(cwd: string): void {
  connectionCache.delete(cwd)
}
