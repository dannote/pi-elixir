import {
  resolveUrl,
  stopAllEmbedded,
  getConnectionKind,
  setStatusCallback,
  type ConnectionKind
} from './tidewave-client.ts'
import { register as registerDepsTree } from './tools/deps-tree.ts'
import { register as registerDocs } from './tools/docs.ts'
import { register as registerEts } from './tools/ets.ts'
import { register as registerEval } from './tools/eval.ts'
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
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    if (!isElixirProject(ctx.cwd)) return

    setStatusCallback((_cwd, kind) => updateStatus(ctx, kind))

    const conn = await resolveUrl(ctx.cwd)
    updateStatus(ctx, conn?.kind ?? getConnectionKind(ctx.cwd))
  })

  pi.on('session_shutdown', async () => {
    stopAllEmbedded()
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
}
