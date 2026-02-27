import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

import { evalTool, loadScript, wrapWithBindings } from '../helpers.ts'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export function register(pi: ExtensionAPI) {
  evalTool(
    pi,
    'elixir_deps_tree',
    'Deps Tree',
    `Show compile-time dependencies for a module using Mix.Xref.
Lists modules that the given module calls (exports) and modules that call it (callers).
Use to understand coupling, find circular dependencies, and navigate unfamiliar codebases.`,
    Type.Object({
      module: Type.String({
        description: 'Module name, e.g. MyApp.Orders or MyAppWeb.OrderController'
      }),
      direction: Type.Optional(
        Type.String({
          description:
            'exports (modules this module calls, default), callers (modules that call this module), or both'
        })
      )
    }),
    (params) =>
      wrapWithBindings(loadScript('deps_tree'), {
        module_name: String(params.module),
        direction: params.direction ?? 'both'
      }),
    (args, theme) => {
      let text = theme.fg('toolTitle', theme.bold('elixir_deps_tree '))
      text += theme.fg('accent', String(args.module ?? ''))
      if (args.direction) text += theme.fg('muted', ` ${args.direction}`)
      return new Text(text, 0, 0)
    }
  )
}
