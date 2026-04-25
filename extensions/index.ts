import {
  resolveUrl,
  stopEmbedded,
  getConnectionKind,
  onStatusChange,
  type ConnectionKind
} from './tidewave-client.ts'
import { register as registerDepsTree } from './tools/deps-tree.ts'
import { register as registerDocs } from './tools/docs.ts'
import { register as registerEts } from './tools/ets.ts'
import { register as registerEval } from './tools/eval.ts'
import { register as registerExAstReplace } from './tools/ex-ast-replace.ts'
import { register as registerExAstSearch } from './tools/ex-ast-search.ts'
import { register as registerHexSearch } from './tools/hex-search.ts'
import { register as registerLogs } from './tools/logs.ts'
import { register as registerProcessInfo } from './tools/process-info.ts'
import { register as registerSchemas } from './tools/schemas.ts'
import { register as registerSource } from './tools/source.ts'
import { register as registerSql } from './tools/sql.ts'
import { register as registerSupTree } from './tools/sup-tree.ts'
import { register as registerTop } from './tools/top.ts'
import { register as registerTypes } from './tools/types.ts'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

function isElixirProject(cwd: string): boolean {
  try {
    const fs = require('node:fs')
    return fs.existsSync(`${cwd}/mix.exs`)
  } catch {
    return false
  }
}

function updateStatus(
  ctx: { ui: { theme: any; setStatus: (id: string, text: string) => void } },
  kind: ConnectionKind
) {
  try {
    const t = ctx.ui.theme
    switch (kind) {
      case 'native':
        ctx.ui.setStatus('elixir', t.fg('success', '⬡') + ' ' + t.fg('muted', 'BEAM'))
        break
      case 'embedded':
        ctx.ui.setStatus('elixir', t.fg('success', '⬡') + ' ' + t.fg('muted', 'BEAM (embedded)'))
        break
      case 'starting':
        ctx.ui.setStatus('elixir', t.fg('warning', '⬡') + ' ' + t.fg('muted', 'BEAM starting…'))
        break
      default:
        ctx.ui.setStatus('elixir', t.fg('warning', '⬡') + ' ' + t.fg('muted', 'BEAM offline'))
    }
  } catch {
    // Status updates are best-effort. Session replacement tears down the old extension context before embedded Tidewave process callbacks can finish, so using the old ctx can throw a stale-context error. Never let a footer update crash pi.
  }
}

export default function (pi: ExtensionAPI) {
  const statusSubscriptions = new Map<string, { cwd: string; unsubscribe: () => void }>()

  function subscriptionKey(ctx: {
    cwd: string
    sessionManager?: { getSessionFile?: () => string | null }
  }) {
    return `${ctx.cwd}:${ctx.sessionManager?.getSessionFile?.() ?? 'ephemeral'}`
  }

  function clearStatusSubscription(key: string) {
    statusSubscriptions.get(key)?.unsubscribe()
    statusSubscriptions.delete(key)
  }

  function hasStatusSubscriptionForCwd(cwd: string) {
    return Array.from(statusSubscriptions.values()).some((subscription) => subscription.cwd === cwd)
  }

  pi.on('session_start', async (_event, ctx) => {
    const key = subscriptionKey(ctx)
    clearStatusSubscription(key)

    if (!isElixirProject(ctx.cwd)) return

    const sessionCwd = ctx.cwd
    const unsubscribe = onStatusChange((cwd, kind) => {
      if (cwd === sessionCwd) updateStatus(ctx, kind)
    })
    statusSubscriptions.set(key, { cwd: sessionCwd, unsubscribe })

    const conn = await resolveUrl(sessionCwd)
    updateStatus(ctx, conn?.kind ?? getConnectionKind(sessionCwd))
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    const key = subscriptionKey(ctx)
    clearStatusSubscription(key)

    if (!hasStatusSubscriptionForCwd(ctx.cwd)) {
      stopEmbedded(ctx.cwd)
    }
  })

  registerEval(pi)
  registerDocs(pi)
  registerSource(pi)
  registerSql(pi)
  registerLogs(pi)
  registerHexSearch(pi)
  registerSchemas(pi)
  registerSupTree(pi)
  registerTop(pi)
  registerProcessInfo(pi)
  registerDepsTree(pi)
  registerTypes(pi)
  registerEts(pi)
  registerExAstSearch(pi)
  registerExAstReplace(pi)
}
