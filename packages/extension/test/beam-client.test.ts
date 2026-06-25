import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { actualReadFileSync } = vi.hoisted(() => ({
  actualReadFileSync: require('node:fs').readFileSync as typeof fs.readFileSync
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs')
  return {
    ...actual,
    readFileSync: vi.fn((path: Parameters<typeof actual.readFileSync>[0], ...args) => {
      if (String(path).endsWith('package.json')) return actualReadFileSync(path, ...args)
      return undefined
    })
  }
})
vi.mock('node:child_process')

import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'

import {
  callTool,
  resolveUrl,
  getConnectionKind,
  onStatusChange,
  stopAllEmbedded
} from '#src/beam-client.js'

function emitStdout(proc: childProcess.ChildProcess, payload: unknown): void {
  const stdout = proc.stdout as EventEmitter
  const line = typeof payload === 'string' ? payload : `${JSON.stringify(payload)}\n`
  stdout.emit('data', Buffer.from(line))
}

function fakeProcess(): childProcess.ChildProcess {
  const proc = new EventEmitter() as childProcess.ChildProcess
  proc.stdout = new EventEmitter() as any
  proc.stderr = new EventEmitter() as any
  proc.stdin = { write: vi.fn((_payload: string, cb?: (error?: Error) => void) => cb?.()) } as any
  proc.kill = vi.fn()
  proc.pid = 12345
  return proc
}

function resetModuleState() {
  stopAllEmbedded()
  vi.mocked(childProcess.spawnSync).mockReturnValue({
    status: 0
  } as childProcess.SpawnSyncReturns<Buffer>)
  delete process.env.PI_DISABLE_EMBEDDED
}

describe('callTool', () => {
  beforeEach(() => {
    resetModuleState()
    vi.clearAllMocks()
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0
    } as childProcess.SpawnSyncReturns<Buffer>)
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('dispatches bridge-native calls over stdio', async () => {
    const proc = fakeProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(proc)

    await resolveUrl('/project')
    emitStdout(proc, {
      type: 'ready',
      info: { project: 'demo', version: '0.0.0', transport: 'stdio' }
    })

    const promise = callTool('stdio:%2Fproject', 'project_eval', { code: '1 + 1' })
    expect(proc.stdin?.write).toHaveBeenCalledWith(
      expect.stringContaining('"name":"project_eval"'),
      expect.any(Function)
    )

    emitStdout(proc, { type: 'result', id: 1, text: '2', isError: false })
    await expect(promise).resolves.toEqual({ text: '2', isError: false })
  })
})

describe('resolveUrl', () => {
  beforeEach(() => {
    resetModuleState()
    vi.clearAllMocks()
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0
    } as childProcess.SpawnSyncReturns<Buffer>)
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns null and starts extension-owned stdio sidecar', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const proc = fakeProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(proc)

    const result = await resolveUrl('/embedded-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'mix',
      expect.arrayContaining(['deps.get', '+', 'run', '--no-halt']),
      expect.objectContaining({
        cwd: expect.stringContaining('/packages/bridge'),
        env: expect.objectContaining({ PI_ELIXIR_TARGET_CWD: '/embedded-project' })
      })
    )
    expect(getConnectionKind('/embedded-project')).toBe('starting')
  })

  it('returns embedded URL after ready event and caches it', async () => {
    const proc = fakeProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(proc)

    expect(await resolveUrl('/ready-project')).toBeNull()
    emitStdout(proc, {
      type: 'ready',
      info: { project: 'demo', version: '0.0.0', transport: 'stdio' }
    })

    const second = await resolveUrl('/ready-project')
    expect(second).toEqual({ url: 'stdio:%2Fready-project', kind: 'embedded' })
    expect(getConnectionKind('/ready-project')).toBe('embedded')
  })

  it('does not start embedded when disabled', async () => {
    process.env.PI_DISABLE_EMBEDDED = '1'
    const result = await resolveUrl('/disabled-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('returns unavailable when Elixir runtime is missing', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 1,
      error: new Error('missing elixir')
    } as childProcess.SpawnSyncReturns<Buffer>)

    const result = await resolveUrl('/runtime-missing')
    expect(result).toBeNull()
    expect(getConnectionKind('/runtime-missing')).toBe('unavailable')
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })
})

describe('onStatusChange', () => {
  beforeEach(() => {
    resetModuleState()
    vi.clearAllMocks()
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0
    } as childProcess.SpawnSyncReturns<Buffer>)
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
  })

  it('notifies subscribers when stdio sidecar becomes ready', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)
    const proc = fakeProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(proc)

    await resolveUrl('/cb-project')
    emitStdout(proc, {
      type: 'ready',
      info: { project: 'demo', version: '0.0.0', transport: 'stdio' }
    })

    expect(cb).toHaveBeenCalledWith('/cb-project', 'embedded')
    unsubscribe()
  })
})
