import { spawn, execSync, type ChildProcess } from 'child_process'
import * as fs from 'node:fs'
import path from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/embedded_tidewave.exs')
const TOOLS_DIR = path.resolve(__dirname, '../../scripts/tools')
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

function elixirLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'nil'
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return 'nil'
}

function evalScript(
  baseUrl: string,
  name: string,
  bindings: Record<string, unknown>
): Promise<{ isError?: boolean; text: string }> {
  const script = fs.readFileSync(path.join(TOOLS_DIR, `${name}.exs`), 'utf-8')
  const assigns = Object.entries(bindings)
    .map(([key, value]) => `${key} = ${elixirLiteral(value)}`)
    .join('\n')
  return mcpCall(baseUrl, 'project_eval', { code: `${assigns}\n\n${script}` })
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

  // --- Protocol & config ---

  it('GET /config returns project info', async () => {
    const res = await fetch(`${baseUrl}/config`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project_name).toBe('json_spec')
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

  // --- Bridge tools (MCP direct) ---

  it('project_eval evaluates expressions', async () => {
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

  it('get_source_location returns file path', async () => {
    const result = await mcpCall(baseUrl, 'get_source_location', {
      reference: 'JSONSpec'
    })
    expect(result.isError).toBeFalsy()
    expect(result.text).toMatch(/json_spec\.ex/)
  })

  it('get_docs returns module documentation', async () => {
    const result = await mcpCall(baseUrl, 'get_docs', { reference: 'JSONSpec' })
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('JSONSpec')
    expect(result.text.length).toBeGreaterThan(50)
  })

  it('get_docs returns function documentation', async () => {
    const result = await mcpCall(baseUrl, 'get_docs', { reference: 'Enum.map/2' })
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('map')
  })

  it('get_logs returns log entries', async () => {
    const result = await mcpCall(baseUrl, 'get_logs', { tail: 10 })
    expect(result.isError).toBeFalsy()
    expect(typeof result.text).toBe('string')
  })

  it('list_ecto_schemas for non-ecto project', async () => {
    const result = await mcpCall(baseUrl, 'list_ecto_schemas', {})
    expect(typeof result.text).toBe('string')
  })

  // --- Tool scripts (eval-based) ---

  describe('top.exs', () => {
    it('returns process list sorted by memory', async () => {
      const result = await evalScript(baseUrl, 'top', {
        sort_by: 'memory',
        max_results: 5
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('mem=')
      expect(result.text).toContain('reds=')
      expect(result.text).toContain('msgq=')
    })

    it('sorts by reductions', async () => {
      const result = await evalScript(baseUrl, 'top', {
        sort_by: 'reductions',
        max_results: 3
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('reds=')
    })
  })

  describe('process_info.exs', () => {
    it('inspects a registered process', async () => {
      const result = await evalScript(baseUrl, 'process_info', {
        target_ref: 'Pi.MCP.Logger'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('PID:')
      expect(result.text).toContain('Memory:')
      expect(result.text).toContain('State:')
      expect(result.text).toContain('Reductions:')
    })

    it('returns error for non-existent process', async () => {
      const result = await evalScript(baseUrl, 'process_info', {
        target_ref: 'NonExistent.Process'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('Process not found')
    })
  })

  describe('sup_tree.exs', () => {
    it('handles project without supervision tree', async () => {
      // json_spec is a pure library — no OTP app supervisor
      const result = await evalScript(baseUrl, 'sup_tree', {
        root_module: null,
        max_depth: null
      })
      // Returns an error message or raises — either way it's a string response
      expect(typeof result.text).toBe('string')
    })
  })

  describe('types.exs', () => {
    it('returns specs for a module', async () => {
      const result = await evalScript(baseUrl, 'types', {
        reference: 'JSONSpec'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('# JSONSpec')
      expect(result.text).toContain('@spec')
    })

    it('returns spec for a specific function', async () => {
      const result = await evalScript(baseUrl, 'types', {
        reference: 'Enum.map/2'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('@spec')
      expect(result.text).toContain('map')
    })

    it('returns types for stdlib module', async () => {
      const result = await evalScript(baseUrl, 'types', {
        reference: 'String'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('@type')
    })
  })

  describe('deps_tree.exs', () => {
    it('returns dependency info for a module', async () => {
      const result = await evalScript(baseUrl, 'deps_tree', {
        module_name: 'JSONSpec',
        direction: 'both'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('# JSONSpec')
      expect(result.text).toContain('Calls (this module depends on)')
      expect(result.text).toContain('Called by (depends on this module)')
    })

    it('returns exports only', async () => {
      const result = await evalScript(baseUrl, 'deps_tree', {
        module_name: 'JSONSpec',
        direction: 'exports'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('Calls')
      expect(result.text).not.toContain('Called by')
    })
  })

  describe('ets.exs', () => {
    it('lists all ETS tables', async () => {
      const result = await evalScript(baseUrl, 'ets', {
        table_name: null,
        match_pattern: null,
        max_rows: 50,
        sort_by: 'memory'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('ETS tables (sorted by memory)')
      expect(result.text).toContain('Name')
      expect(result.text).toContain('Size')
    })

    it('inspects a specific table', async () => {
      // :elixir_config always exists in any BEAM
      const result = await evalScript(baseUrl, 'ets', {
        table_name: 'elixir_config',
        match_pattern: null,
        max_rows: 50,
        sort_by: 'memory'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('Name:       :elixir_config')
      expect(result.text).toContain('Type:')
      expect(result.text).toContain('Contents')
    })

    it('returns error for non-existent table', async () => {
      const result = await evalScript(baseUrl, 'ets', {
        table_name: 'nonexistent_table_xyz',
        match_pattern: null,
        max_rows: 50,
        sort_by: 'memory'
      })
      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('ETS table not found')
    })
  })
})
