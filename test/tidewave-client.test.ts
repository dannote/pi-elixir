import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs')
vi.mock('node:child_process')

import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'

import {
  callTool,
  resolveUrl,
  getConnectionKind,
  setStatusCallback,
  stopAllEmbedded
} from '../extensions/tidewave-client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function invalidResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}

// Reset module-level state between tests by clearing internal Maps/Sets.
// We access them indirectly through the public API.
function resetModuleState() {
  stopAllEmbedded()
  // Clear env overrides
  delete process.env.TIDEWAVE_URL
  delete process.env.PI_ELIXIR_DISABLE_EMBEDDED
}

describe('callTool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns text content on successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' }
          ],
          isError: false
        }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 'some_tool', { key: 'val' })
    expect(result).toEqual({ text: 'hello\nworld', isError: false })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://localhost:4000/mcp')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.method).toBe('tools/call')
    expect(body.params).toEqual({ name: 'some_tool', arguments: { key: 'val' } })
  })

  it('returns isError from the result payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'boom' }],
          isError: true
        }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 'fail_tool', {})
    expect(result).toEqual({ text: 'boom', isError: true })
  })

  it('defaults isError to false when omitted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'ok' }] }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(false)
  })

  it('filters out non-text content types', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            { type: 'image', text: 'should be ignored' },
            { type: 'text', text: 'kept' }
          ]
        }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.text).toBe('kept')
  })

  it('returns empty string when result has no content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }))

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.text).toBe('')
  })

  it('returns friendly error on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Could not reach BEAM')
    expect(result.text).toContain('ECONNREFUSED')
    expect(result.text).toContain('http://localhost:4000/mcp')
  })

  it('handles non-Error thrown from fetch', async () => {
    vi.mocked(fetch).mockRejectedValueOnce('string error')

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('string error')
  })

  it('returns error on invalid JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(invalidResponse('not json', 200))

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('invalid response')
    expect(result.text).toContain('HTTP 200')
  })

  it('returns error on JSON-RPC error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result).toEqual({ text: 'MCP error -32600: Invalid Request', isError: true })
  })

  it('passes AbortSignal to fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [] } })
    )

    const controller = new AbortController()
    await callTool('http://localhost:4000/mcp', 't', {}, controller.signal)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.signal).toBe(controller.signal)
  })
})

describe('resolveUrl', () => {
  beforeEach(() => {
    resetModuleState()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns TIDEWAVE_URL env var when set', async () => {
    process.env.TIDEWAVE_URL = 'http://custom:9999/mcp'

    const result = await resolveUrl('/some/project')
    expect(result).toEqual({ url: 'http://custom:9999/mcp', kind: 'native' })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns cached connection within TTL', async () => {
    // First call: discovery finds a native server on port 4000
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/tidewave/config') {
        return jsonResponse({ project_name: 'my_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    vi.mocked(fs.readFileSync).mockReturnValue('app: :my_app')

    const first = await resolveUrl('/project')
    expect(first).toEqual({ url: 'http://localhost:4000/tidewave/mcp', kind: 'native' })

    // Second call within TTL should use cache — reset fetch to reject everything
    vi.mocked(fetch).mockRejectedValue(new Error('should not be called'))

    const second = await resolveUrl('/project')
    expect(second).toEqual({ url: 'http://localhost:4000/tidewave/mcp', kind: 'native' })
  })

  it('re-discovers after cache TTL expires', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/tidewave/config') {
        return jsonResponse({ project_name: 'my_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    vi.mocked(fs.readFileSync).mockReturnValue('app: :my_app')

    await resolveUrl('/project2')

    // Advance past TTL (30s)
    vi.advanceTimersByTime(31_000)

    // fetch is called again for re-discovery
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4001/tidewave/config') {
        return jsonResponse({ project_name: 'my_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    const result = await resolveUrl('/project2')
    expect(result).toEqual({ url: 'http://localhost:4001/tidewave/mcp', kind: 'native' })
    expect(fetch).toHaveBeenCalled()
  })

  it('returns null and starts embedded when no native server found', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    const result = await resolveUrl('/embedded-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'mix',
      expect.arrayContaining(['run', '--no-halt']),
      expect.objectContaining({ cwd: '/embedded-project' })
    )
  })

  it('returns null immediately for failed cwds', async () => {
    // First: trigger embedded failure
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/failed-project')

    // Simulate exit without becoming ready → marks as failed
    fakeProc.emit('exit')

    vi.mocked(childProcess.spawn).mockClear()

    const result = await resolveUrl('/failed-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('returns null when PI_ELIXIR_DISABLE_EMBEDDED is set', async () => {
    process.env.PI_ELIXIR_DISABLE_EMBEDDED = '1'
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = await resolveUrl('/disabled-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('returns embedded URL when process is ready', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    // First call starts embedded
    const first = await resolveUrl('/ready-project')
    expect(first).toBeNull()

    // Simulate readiness
    ;(fakeProc.stdout as EventEmitter).emit(
      'data',
      Buffer.from('PI_MCP_READY port=4041 server=gen_tcp')
    )

    // Second call should find the ready embedded process
    const second = await resolveUrl('/ready-project')
    expect(second).not.toBeNull()
    expect(second!.kind).toBe('embedded')
    expect(second!.url).toContain('/mcp')
  })

  it('matches native server by app name from mix.exs', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('  app: :specific_app,')

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4002/tidewave/config') {
        return jsonResponse({ project_name: 'wrong_app', framework_type: 'phoenix' })
      }
      if (url === 'http://localhost:4005/tidewave/config') {
        return jsonResponse({ project_name: 'specific_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    const result = await resolveUrl('/matched-project')
    expect(result).toEqual({ url: 'http://localhost:4005/tidewave/mcp', kind: 'native' })
  })

  it('returns null when native servers exist but none match the app name', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('  app: :my_app,')

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/tidewave/config') {
        return jsonResponse({ project_name: 'other_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 99
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    const result = await resolveUrl('/mismatched-project')
    expect(result).toBeNull()
  })
})

describe('getConnectionKind', () => {
  beforeEach(() => {
    resetModuleState()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns null when no connection exists', () => {
    expect(getConnectionKind('/unknown')).toBeNull()
  })

  it("returns 'starting' when embedded process is running but not ready", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/starting-project')
    expect(getConnectionKind('/starting-project')).toBe('starting')
  })

  it("returns 'embedded' when process becomes ready", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/embedded-kind-project')
    ;(fakeProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY'))

    expect(getConnectionKind('/embedded-kind-project')).toBe('embedded')
  })

  it("returns 'native' when cached from discovery", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/tidewave/config') {
        return jsonResponse({ project_name: 'app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })
    vi.mocked(fs.readFileSync).mockReturnValue('app: :app')

    await resolveUrl('/native-kind-project')
    expect(getConnectionKind('/native-kind-project')).toBe('native')
  })

  it('returns null after embedded process exits without readiness', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/exit-project')
    expect(getConnectionKind('/exit-project')).toBe('starting')

    fakeProc.emit('exit')
    expect(getConnectionKind('/exit-project')).toBeNull()
  })
})

describe('setStatusCallback', () => {
  beforeEach(() => {
    resetModuleState()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    setStatusCallback(null as any)
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('fires callback when embedded process becomes ready', async () => {
    const cb = vi.fn()
    setStatusCallback(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/cb-project')
    ;(fakeProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY'))

    expect(cb).toHaveBeenCalledWith('/cb-project', 'embedded')
  })

  it('fires callback with null when embedded process exits', async () => {
    const cb = vi.fn()
    setStatusCallback(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/cb-exit-project')
    fakeProc.emit('exit')

    expect(cb).toHaveBeenCalledWith('/cb-exit-project', null)
  })

  it('fires callback with null on process error', async () => {
    const cb = vi.fn()
    setStatusCallback(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/cb-error-project')
    fakeProc.emit('error', new Error('spawn failed'))

    expect(cb).toHaveBeenCalledWith('/cb-error-project', null)
  })
})
