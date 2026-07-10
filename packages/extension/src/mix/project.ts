import * as fs from 'node:fs'
import * as path from 'node:path'

import { recordDiagnostic } from '#src/diagnostics.ts'

const PREFERRED_NESTED_MIX_PATHS = ['packages/bridge/mix.exs']
const RESOLVE_CACHE_TTL_MS = 2_000
const resolvedMixProjectCache = new Map<string, { value: string | null; timestamp: number }>()

export function resolveMixProjectCwd(cwd: string): string | null {
  const cached = resolvedMixProjectCache.get(cwd)
  if (cached && Date.now() - cached.timestamp < RESOLVE_CACHE_TTL_MS) {
    if (!cached.value || fs.existsSync(path.join(cached.value, 'mix.exs'))) return cached.value
  }

  const resolved = resolveMixProjectCwdUncached(cwd)
  resolvedMixProjectCache.set(cwd, { value: resolved, timestamp: Date.now() })
  return resolved
}

function resolveMixProjectCwdUncached(cwd: string): string | null {
  const startedAt = Date.now()
  if (fs.existsSync(path.join(cwd, 'mix.exs'))) {
    recordDiagnostic('mix_project_resolve', cwd, {
      result: cwd,
      reason: 'cwd_mix_exs',
      durationMs: Date.now() - startedAt
    })
    return cwd
  }

  for (const relative of PREFERRED_NESTED_MIX_PATHS) {
    const candidate = path.join(cwd, relative)
    if (fs.existsSync(candidate)) {
      const result = path.dirname(candidate)
      recordDiagnostic('mix_project_resolve', cwd, {
        result,
        reason: relative,
        durationMs: Date.now() - startedAt
      })
      return result
    }
  }

  recordDiagnostic('mix_project_resolve', cwd, {
    result: null,
    reason: 'no_direct_mix_project_recursive_scan_disabled',
    durationMs: Date.now() - startedAt
  })
  return null
}
