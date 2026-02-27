import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

import { bridgeTool, formatHexSearchResults } from '../helpers.ts'
import { renderMarkdownResult } from '../renderers.ts'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_hex_search',
    'search_package_docs',
    'HexDocs Search',
    `Search HexDocs filtered to your project's exact dependency versions.`,
    Type.Object({
      q: Type.String({ description: 'Search query' }),
      packages: Type.Optional(
        Type.Array(Type.String(), { description: 'Limit to specific packages' })
      )
    }),
    (args, theme) => {
      let text = theme.fg('toolTitle', theme.bold('elixir_hex_search '))
      text += theme.fg('accent', `"${args.q}"`)
      return new Text(text, 0, 0)
    },
    { transformResult: formatHexSearchResults, renderResult: renderMarkdownResult }
  )
}
