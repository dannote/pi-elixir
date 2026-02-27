import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

let requestId = 0

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: {
    content?: Array<{ type: string; text: string }>
    isError?: boolean
  }
  error?: { code: number; message: string }
}

export async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ text: string; isError: boolean }> {
  const id = ++requestId

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args }
      }),
      signal
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      text: `Could not reach BEAM at ${url} (${msg}). Is the Phoenix server running?`,
      isError: true
    }
  }

  let json: JsonRpcResponse
  try {
    json = await resp.json()
  } catch {
    return {
      text: `BEAM returned invalid response (HTTP ${resp.status}). The server may be starting up or misconfigured.`,
      isError: true
    }
  }

  if (json.error) {
    return { text: `MCP error ${json.error.code}: ${json.error.message}`, isError: true }
  }

  const text = (json.result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')

  return { text, isError: json.result?.isError ?? false }
}

// --- Tidewave discovery ---

interface TidewaveConfig {
  project_name: string
  framework_type: string
}

async function fetchConfig(baseUrl: string): Promise<TidewaveConfig | null> {
  try {
    const resp = await fetch(baseUrl.replace(/\/mcp$/, '/config'), {
      signal: AbortSignal.timeout(1000)
    })
    if (!resp.ok) return null
    return (await resp.json()) as TidewaveConfig
  } catch {
    return null
  }
}

function readAppName(cwd: string): string | null {
  try {
    const mixExs = fs.readFileSync(`${cwd}/mix.exs`, 'utf-8')
    const match = mixExs.match(/app:\s*:(\w+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

const PROBE_PORTS = [4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009]

async function discoverNativeTidewave(cwd: string): Promise<string | null> {
  const appName = readAppName(cwd)

  const probes = PROBE_PORTS.map(async (port) => {
    const url = `http://localhost:${port}/tidewave/mcp`
    const config = await fetchConfig(url)
    return config ? { url, config } : null
  })

  const results = (await Promise.all(probes)).filter(
    (r): r is { url: string; config: TidewaveConfig } => r !== null
  )

  if (results.length === 0) return null

  if (appName) {
    const match = results.find((r) => r.config.project_name === appName)
    return match?.url ?? null
  }

  return results[0].url
}

// --- Embedded server management ---

interface EmbeddedProcess {
  proc: childProcess.ChildProcess
  url: string
  port: number
  ready: boolean
}

type StatusCallback = (cwd: string, kind: ConnectionKind) => void

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/embedded_tidewave.exs')

const embeddedProcesses = new Map<string, EmbeddedProcess>()
const embeddedFailed = new Set<string>()
let onStatusChange: StatusCallback | null = null

export function setStatusCallback(cb: StatusCallback): void {
  onStatusChange = cb
}

function startEmbeddedInBackground(cwd: string): void {
  const existing = embeddedProcesses.get(cwd)
  if (existing) return

  const proc = childProcess.spawn('mix', ['run', '--no-halt', SCRIPT_PATH, '--port', '0'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MIX_ENV: 'dev' }
  })

  const entry: EmbeddedProcess = { proc, url: '', port: 0, ready: false }
  embeddedProcesses.set(cwd, entry)

  proc.stdout!.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    if (!entry.ready && text.includes('PI_MCP_READY')) {
      const portMatch = text.match(/port=(\d+)/)
      if (portMatch) {
        entry.port = parseInt(portMatch[1], 10)
        entry.url = `http://127.0.0.1:${entry.port}/mcp`
      }
      entry.ready = true
      connectionCache.delete(cwd)
      onStatusChange?.(cwd, 'embedded')
    }
  })

  proc.on('error', () => {
    embeddedProcesses.delete(cwd)
    embeddedFailed.add(cwd)
    onStatusChange?.(cwd, null)
  })

  proc.on('exit', () => {
    const wasReady = entry.ready
    embeddedProcesses.delete(cwd)
    connectionCache.delete(cwd)
    if (!wasReady) {
      embeddedFailed.add(cwd)
    }
    onStatusChange?.(cwd, null)
  })
}

function stopEmbedded(cwd: string): void {
  const entry = embeddedProcesses.get(cwd)
  if (entry) {
    entry.proc.kill()
    embeddedProcesses.delete(cwd)
  }
}

export function stopAllEmbedded(): void {
  for (const [cwd] of embeddedProcesses) {
    stopEmbedded(cwd)
  }
}

// --- Unified URL resolution ---

export type ConnectionKind = 'native' | 'embedded' | 'starting' | null

interface CachedConnection {
  url: string
  kind: ConnectionKind
  timestamp: number
}

const connectionCache = new Map<string, CachedConnection>()
const CACHE_TTL = 30_000

export async function resolveUrl(
  cwd: string
): Promise<{ url: string; kind: ConnectionKind } | null> {
  if (process.env.TIDEWAVE_URL) {
    return { url: process.env.TIDEWAVE_URL, kind: 'native' }
  }

  const cached = connectionCache.get(cwd)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { url: cached.url, kind: cached.kind }
  }

  const nativeUrl = await discoverNativeTidewave(cwd)
  if (nativeUrl) {
    connectionCache.set(cwd, { url: nativeUrl, kind: 'native', timestamp: Date.now() })
    return { url: nativeUrl, kind: 'native' }
  }

  if (process.env.PI_ELIXIR_DISABLE_EMBEDDED === '1') return null
  if (embeddedFailed.has(cwd)) return null

  const embedded = embeddedProcesses.get(cwd)
  if (embedded?.ready) {
    connectionCache.set(cwd, { url: embedded.url, kind: 'embedded', timestamp: Date.now() })
    return { url: embedded.url, kind: 'embedded' }
  }

  if (!embedded) {
    startEmbeddedInBackground(cwd)
  }

  return null
}

export function invalidateCache(cwd: string): void {
  connectionCache.delete(cwd)
}

export function getConnectionKind(cwd: string): ConnectionKind {
  const cached = connectionCache.get(cwd)
  if (cached) return cached.kind
  const embedded = embeddedProcesses.get(cwd)
  if (embedded?.ready) return 'embedded'
  if (embedded) return 'starting'
  return null
}
