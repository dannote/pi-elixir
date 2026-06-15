import * as childProcess from 'node:child_process'

export interface ElixirVersion {
  major: number
  minor: number
  patch: number | null
  raw: string
}

function commandExists(command: string): boolean {
  const result = childProcess.spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 3_000
  })

  return result?.status === 0
}

export function detectElixirVersion(cwd = process.cwd()): ElixirVersion | null {
  const result = childProcess.spawnSync('elixir', ['--version'], {
    cwd,
    encoding: 'utf8',
    timeout: 3_000
  })

  if (result.status !== 0) return null

  const output = [result.stdout, result.stderr]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
  const raw = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('Elixir '))
  const match = raw?.match(/^Elixir\s+(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!raw || !match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : null,
    raw
  }
}

export function shouldRecommendElixir120(version: ElixirVersion | null): boolean {
  if (!version) return false
  return version.major < 1 || (version.major === 1 && version.minor < 20)
}

export function elixirRuntimeProblem(): string | null {
  if (!commandExists('elixir')) {
    return 'Elixir is not installed or not available on PATH. Install Elixir/OTP before using pi-elixir BEAM tools.'
  }

  if (!commandExists('mix')) {
    return 'Mix is not available on PATH. Install a complete Elixir distribution before using pi-elixir BEAM tools.'
  }

  return null
}
