import { spawn, execSync, type ChildProcess } from 'child_process'
import path from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/embedded_tidewave.exs')
const PROJECT_DIR = path.resolve(__dirname, '../../../json_spec')
const STARTUP_TIMEOUT = 120_000

function hasElixir(): boolean {
  try {
    execSync('elixir --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const elixirAvailable = hasElixir()

let mcpId = 0

async function mcpCall(
  baseUrl: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ isError?: boolean; text: string }> {
  const id = ++mcpId
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.jsonrpc).toBe('2.0')
  expect(body.id).toBe(id)
  const content = body.result.content[0]
  return { isError: body.result.isError, text: content.text }
}

describe.skipIf(!elixirAvailable)('embedded MCP server', () => {
  let serverProcess: ChildProcess
  let baseUrl: string

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('mix', ['run', '--no-halt', SCRIPT_PATH, '--port', '0'], {
        cwd: PROJECT_DIR,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      serverProcess = proc

      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error(`Server failed to start within ${STARTUP_TIMEOUT}ms`))
      }, STARTUP_TIMEOUT)

      let stderr = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const match = text.match(/PI_MCP_READY port=(\d+)/)
        if (match) {
          baseUrl = `http://127.0.0.1:${match[1]}`
          clearTimeout(timeout)
          resolve()
        }
      })

      proc.on('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Server exited with code ${code} before ready.\nstderr: ${stderr}`))
      })
    })
  }, STARTUP_TIMEOUT)

  afterAll(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill()
    }
  })

  it('GET /config returns project info', async () => {
    const res = await fetch(`${baseUrl}/config`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project_name).toBe('json_spec')
    expect(body.framework_type).toBe('embedded')
  })

  it('project_eval evaluates 1 + 1', async () => {
    const result = await mcpCall(baseUrl, 'project_eval', { code: '1 + 1' })
    expect(result.isError).toBeFalsy()
    expect(result.text).toBe('2')
  })

  it('project_eval can access project modules', async () => {
    const result = await mcpCall(baseUrl, 'project_eval', {
      code: 'Code.ensure_loaded?(JSONSpec)'
    })
    expect(result.isError).toBeFalsy()
    expect(result.text).toBe('true')
  })

  it('get_source_location for JSONSpec returns a file path', async () => {
    const result = await mcpCall(baseUrl, 'get_source_location', {
      reference: 'JSONSpec'
    })
    expect(result.isError).toBeFalsy()
    expect(result.text).toMatch(/json_spec\.ex/)
  })

  it('get_docs for JSONSpec returns documentation', async () => {
    const result = await mcpCall(baseUrl, 'get_docs', { reference: 'JSONSpec' })
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('JSONSpec')
    expect(result.text.length).toBeGreaterThan(50)
  })

  it('get_logs returns log output', async () => {
    const result = await mcpCall(baseUrl, 'get_logs', { tail: 10 })
    expect(result.isError).toBeFalsy()
    expect(typeof result.text).toBe('string')
  })

  it('POST /mcp with invalid JSON returns 400', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{'
    })
    expect(res.status).toBe(400)
  })

  it('POST /mcp with initialize method returns success', async () => {
    const id = ++mcpId
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {}
      })
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(id)
    expect(body.result).toBeDefined()
  })
})
