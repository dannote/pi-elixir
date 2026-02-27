import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

import { evalTool, loadScript, wrapWithBindings } from '../helpers.ts'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export function register(pi: ExtensionAPI) {
  evalTool(
    pi,
    'elixir_process_info',
    'Process Info',
    `Get detailed information about a specific BEAM process.
Accepts a registered name (e.g. MyApp.Repo) or PID string (e.g. "0.500.0").
Returns: state, message queue, memory, reductions, links, monitors, current function, and more.`,
    Type.Object({
      process: Type.String({
        description:
          'Registered process name (e.g. MyApp.Repo, Elixir.MyApp.Repo) or PID (e.g. "0.500.0")'
      })
    }),
    (params) => {
      const proc = String(params.process)
      const ref = proc.match(/^\d+\.\d+\.\d+$/) ? `pid:${proc}` : proc
      return wrapWithBindings(loadScript('process_info'), { target_ref: ref })
    },
    (args, theme) =>
      new Text(
        theme.fg('toolTitle', theme.bold('elixir_process_info ')) +
          theme.fg('accent', String(args.process ?? '')),
        0,
        0
      )
  )
}
