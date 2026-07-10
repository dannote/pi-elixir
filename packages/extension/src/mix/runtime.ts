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
  const result = childProcess.spawnSync('elixir', ['--eval', 'IO.write(System.version())'], {
    cwd,
    encoding: 'utf8',
    timeout: 3_000
  })

  if (result.status !== 0 || typeof result.stdout !== 'string') return null

  const raw = result.stdout.trim()
  const core = raw.split('-', 1)[0].split('+', 1)[0]
  const parts = core.split('.').map(Number)
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return null
  }

  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2] ?? null,
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
