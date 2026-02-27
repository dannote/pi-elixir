import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

import { bridgeTool } from '../helpers.ts'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_schemas',
    'get_ecto_schemas',
    'Ecto Schemas',
    'List all Ecto schema modules with file paths. Prefer over grep for schema discovery.',
    Type.Object({}),
    (_args, theme) => new Text(theme.fg('toolTitle', theme.bold('elixir_schemas')), 0, 0)
  )
}
