import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}))

import * as childProcess from 'node:child_process'

import {
  detectElixirVersion,
  elixirRuntimeProblem,
  shouldRecommendElixir120
} from '#src/mix/runtime.ts'

describe('elixirRuntimeProblem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when elixir and mix are available', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0
    } as childProcess.SpawnSyncReturns<Buffer>)

    expect(elixirRuntimeProblem()).toBeNull()
  })

  it('explains when elixir is missing', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 127
    } as childProcess.SpawnSyncReturns<Buffer>)

    expect(elixirRuntimeProblem()).toContain('Elixir is not installed')
  })

  it('explains when mix is missing from an incomplete Elixir install', () => {
    const spawn = vi.mocked(childProcess.spawnSync)
    spawn.mockReturnValueOnce({ status: 0 } as childProcess.SpawnSyncReturns<Buffer>)
    spawn.mockReturnValueOnce({ status: 127 } as childProcess.SpawnSyncReturns<Buffer>)

    expect(elixirRuntimeProblem()).toContain('Mix is not available')
  })

  it('detects Elixir versions for startup recommendations', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0,
      stdout: '1.19.3',
      stderr: ''
    } as childProcess.SpawnSyncReturns<Buffer>)

    const version = detectElixirVersion('/tmp/project')

    expect(version).toMatchObject({ major: 1, minor: 19, patch: 3, raw: '1.19.3' })
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      'elixir',
      ['--eval', 'IO.write(System.version())'],
      expect.objectContaining({ cwd: '/tmp/project' })
    )
    expect(shouldRecommendElixir120(version)).toBe(true)
  })

  it('does not recommend upgrades for Elixir 1.20+', () => {
    expect(shouldRecommendElixir120({ major: 1, minor: 20, patch: 0, raw: 'Elixir 1.20.0' })).toBe(
      false
    )
  })
})
