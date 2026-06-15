import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}))

vi.mock('#src/connection/resolver.ts', () => ({
  getConnectionKind: vi.fn(() => null)
}))

vi.mock('#src/connection/status.ts', () => ({
  getIncompatibleDependency: vi.fn(() => undefined),
  getUnavailableReason: vi.fn(() => undefined)
}))

vi.mock('#src/embedded/stdio-process.ts', () => ({
  getBridgeInfo: vi.fn(() => undefined),
  getEmbeddedUrl: vi.fn(() => 'stdio:/tmp/project')
}))

import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { buildElixirDoctorReport, buildElixirStatusReport } from '#src/diagnostics/doctor.ts'

function makeProject(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-doctor-'))
  fs.writeFileSync(path.join(cwd, 'mix.exs'), 'defmodule Demo.MixProject do\nend\n')
  return cwd
}

function mockVersions(elixirVersion: string) {
  vi.mocked(childProcess.spawnSync).mockImplementation((command, args) => {
    const executable = String(command)
    const argv = Array.isArray(args) ? args.map(String) : []

    if (executable === 'elixir' && argv.includes('--version')) {
      return {
        status: 0,
        stdout: `Erlang/OTP 27 [erts-15.0]\nElixir ${elixirVersion}\n`,
        stderr: ''
      } as childProcess.SpawnSyncReturns<Buffer>
    }

    if (executable === 'mix' && argv.includes('--version')) {
      return {
        status: 0,
        stdout: `Erlang/OTP 27 [erts-15.0]\nMix 1.20.0\n`,
        stderr: ''
      } as childProcess.SpawnSyncReturns<Buffer>
    }

    if (executable === 'mise') {
      return { status: 1, stdout: '', stderr: '' } as childProcess.SpawnSyncReturns<Buffer>
    }

    return { status: 0, stdout: '', stderr: '' } as childProcess.SpawnSyncReturns<Buffer>
  })
}

describe('pi-elixir diagnostics', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('recommends Elixir 1.20+ for projects running an older supported compiler', () => {
    const cwd = makeProject()
    mockVersions('1.19.3')

    expect(buildElixirDoctorReport(cwd)).toContain('Elixir 1.20+ (OTP 27+) is recommended')
    expect(buildElixirStatusReport(cwd)).toContain('Elixir 1.20+ (OTP 27+) is recommended')

    fs.rmSync(cwd, { recursive: true, force: true })
  })

  it('does not show the upgrade recommendation on Elixir 1.20+', () => {
    const cwd = makeProject()
    mockVersions('1.20.0')

    expect(buildElixirDoctorReport(cwd)).not.toContain('Elixir 1.20+ (OTP 27+) is recommended')

    fs.rmSync(cwd, { recursive: true, force: true })
  })
})
