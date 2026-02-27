import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

import { bridgeTool } from '../helpers.ts'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_source',
    'get_source_location',
    'Elixir Source',
    `Get source file:line for a module or function. The BEAM knows where everything is defined.
Accepts: Module, Module.function, Module.function/arity, dep:package_name.
Prefer over grep when you know the module/function name.`,
    Type.Object({
      reference: Type.String({
        description: 'e.g. MyApp.Orders.create/1, dep:phoenix'
      })
    }),
    (args, theme) =>
      new Text(
        theme.fg('toolTitle', theme.bold('elixir_source ')) +
          theme.fg('accent', String(args.reference ?? '')),
        0,
        0
      )
  )
}
