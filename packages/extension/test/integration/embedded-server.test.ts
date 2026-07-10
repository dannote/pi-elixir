import { spawn, execSync, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const PROJECT_DIR =
  process.env.PI_ELIXIR_INTEGRATION_PROJECT ??
  path.resolve(__dirname, '../../../fixtures/demo_project')
const BRIDGE_DIR = path.resolve(__dirname, '../../../bridge')
const START_SERVER_EXPR = 'Pi.MCP.Server.start!(System.argv())'
const STARTUP_TIMEOUT = 120_000

function ensureDeps(): void {
  execSync('mix deps.get', { cwd: BRIDGE_DIR, stdio: 'pipe' })
  execSync('mix compile', { cwd: PROJECT_DIR, stdio: 'pipe' })
}

function hasElixir(): boolean {
  try {
    execSync('elixir --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const elixirAvailable = hasElixir()
const projectAvailable = fs.existsSync(PROJECT_DIR)

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

describe.skipIf(!elixirAvailable || !projectAvailable)('embedded MCP server', () => {
  let serverProcess: ChildProcess
  let baseUrl: string

  beforeAll(async () => {
    ensureDeps()
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'mix',
        ['run', '--no-halt', '-e', START_SERVER_EXPR, '--', '--port', '0'],
        {
          cwd: BRIDGE_DIR,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PI_ELIXIR_PROJECT_CWD: PROJECT_DIR,
            PI_ELIXIR_MIRROR: '0'
          }
        }
      )

      serverProcess = proc

      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error(`Server failed to start within ${STARTUP_TIMEOUT}ms`))
      }, STARTUP_TIMEOUT)

      let stderr = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      let stdout = ''
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        const lines = stdout.split('\n')
        stdout = lines.pop() ?? ''

        for (const line of lines) {
          try {
            const message: unknown = JSON.parse(line)
            if (
              typeof message === 'object' &&
              message !== null &&
              'event' in message &&
              message.event === 'pi_mcp_ready' &&
              'port' in message &&
              typeof message.port === 'number'
            ) {
              baseUrl = `http://127.0.0.1:${message.port}`
              clearTimeout(timeout)
              resolve()
            }
          } catch {
            // Mix may write non-protocol startup output before the JSON readiness event.
          }
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

  // --- Protocol & config ---

  it('GET /config returns project info', async () => {
    const res = await fetch(`${baseUrl}/config`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project_name).toBe('pi_demo_project')
    expect(body.project_root).toBe(PROJECT_DIR)
    expect(body.framework_type).toBe('embedded')
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

  // --- Minimal model-facing tool backend ---

  it('project_eval evaluates expressions', async () => {
    const result = await mcpCall(baseUrl, 'project_eval', { code: '1 + 1' })
    expect(result.isError).toBeFalsy()
    expect(result.text).toBe('2')
  })

  it('project_eval loads project modules without loading pi_bridge into the target', async () => {
    const result = await mcpCall(baseUrl, 'project_eval', {
      code: '{Code.ensure_loaded?(PiDemoProject), Code.ensure_loaded?(Pi)}'
    })
    expect(result.isError).toBeFalsy()
    expect(result.text).toBe('{true, false}')
  })

  describe('ex_ast_search', () => {
    it('finds Elixir syntax structurally', async () => {
      const result = await mcpCall(baseUrl, 'ex_ast_search', {
        pattern: 'defmodule _ do _ end',
        path: 'lib/pi_demo_project.ex'
      })
      if (result.isError || result.text.startsWith('ex_ast is not installed')) {
        expect(result.text).toContain('ex_ast is not installed')
        return
      }

      const payload = JSON.parse(result.text)
      expect(payload.kind).toBe('ast_search')
      expect(payload.matches[0].source).toContain('defmodule PiDemoProject do')
    })
  })
})
