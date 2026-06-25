import { recordDiagnostic, withDiagnosticSpan } from '#src/diagnostics.ts'
import {
  callEmbeddedTool,
  clearEmbeddedFailed,
  cwdFromEmbeddedUrl,
  embeddedStartupTranscript,
  getEmbeddedKind,
  getEmbeddedUrl,
  hasEmbeddedFailed,
  isEmbeddedReady,
  sendEmbeddedEvent,
  startEmbeddedInBackground
} from '#src/embedded/stdio-process.ts'
import { elixirRuntimeProblem } from '#src/mix/runtime.ts'
import type { BridgeEvent, ToolArgs, ToolResult } from '#src/protocol/types.ts'

import {
  clearUnavailable,
  connectionCache,
  getUnavailableReason,
  markUnavailable,
  type ConnectionKind
} from './status.ts'

export type { ConnectionKind }

export interface ConnectionResolution {
  url: string
  kind: ConnectionKind
}

const CACHE_TTL = 30_000

export async function callTool(
  url: string,
  name: string,
  args: ToolArgs,
  signal?: AbortSignal
): Promise<ToolResult> {
  return withDiagnosticSpan(
    'bridge_tool_call',
    cwdFromEmbeddedUrl(url),
    { name, kind: 'embedded' },
    async () => callEmbeddedTool(cwdFromEmbeddedUrl(url), name, args, signal)
  )
}

export function sendBridgeEvent(cwd: string, event: BridgeEvent): Promise<void> {
  return sendEmbeddedEvent(cwd, event)
}

export async function resolveUrl(cwd: string): Promise<ConnectionResolution | null> {
  return withDiagnosticSpan('resolve_url', cwd, undefined, async () => {
    const cached = connectionCache.get(cwd)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'cache_hit', kind: cached.kind })
      return { url: cached.url, kind: cached.kind }
    }

    if (process.env.PI_DISABLE_EMBEDDED === '1') {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_disabled' })
      return null
    }

    const runtimeProblem = elixirRuntimeProblem()
    if (runtimeProblem) {
      markUnavailable(cwd, runtimeProblem)
      recordDiagnostic('resolve_url_phase', cwd, {
        phase: 'elixir_runtime_unavailable',
        reason: runtimeProblem
      })
      return null
    }
    clearUnavailable(cwd)

    if (hasEmbeddedFailed(cwd)) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_failed' })
      return null
    }

    clearEmbeddedFailed(cwd)

    if (isEmbeddedReady(cwd)) {
      const url = getEmbeddedUrl(cwd)
      connectionCache.set(cwd, { url, kind: 'embedded', timestamp: Date.now() })
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_ready' })
      return { url, kind: 'embedded' }
    }

    startEmbeddedInBackground(cwd)
    recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_starting' })
    return null
  })
}

export function getStartupTranscript(cwd: string): string | null {
  return embeddedStartupTranscript(cwd)
}

export function getConnectionKind(cwd: string): ConnectionKind {
  const cached = connectionCache.get(cwd)
  if (cached) return cached.kind
  if (getUnavailableReason(cwd)) return 'unavailable'
  return getEmbeddedKind(cwd)
}
