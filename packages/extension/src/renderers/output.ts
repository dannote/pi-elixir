import { getMarkdownTheme, highlightCode, type Theme } from '@earendil-works/pi-coding-agent'
import { Markdown, visibleWidth, type Component } from '@earendil-works/pi-tui'

import { truncateLine } from '../helpers.ts'
import { numberMetadata, stringMetadata } from './output-metadata.ts'
import type { OutputPart } from './output-types.ts'
import { renderWebDocument } from './output-web.ts'
import {
  codeFrameLines,
  codeLines,
  comparableInspectText,
  compactText,
  expandHint,
  hiddenLine,
  highlightedFrameLines,
  inlineExpandHint,
  renderCompactLine,
  renderLines,
  stripFinalNewline
} from './shared.ts'

interface HighlightSpan {
  text?: string
  scopes?: unknown[]
}

interface HighlightPayload {
  engine?: string
  language?: string
  lines?: HighlightSpan[][]
}

function partPreview(part: OutputPart) {
  return part.title ?? compactText(part.body ?? '')
}

function partHasSemanticHiddenOutput(part: OutputPart) {
  const output = part.body ?? ''
  const preview = partPreview(part)
  return comparableInspectText(output) !== comparableInspectText(preview)
}

interface TablePayload {
  columns?: unknown[]
  rows?: unknown[][]
  total_rows?: unknown
  totalRows?: unknown
  column_types?: unknown[]
  columnTypes?: unknown[]
  alignments?: unknown[]
}

interface TreeNode {
  key?: unknown
  value?: unknown
}

function parseJsonPart(part: OutputPart): unknown {
  try {
    return JSON.parse(part.body ?? '')
  } catch {
    return null
  }
}

function tableCell(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

interface RenderTableData {
  columns: string[]
  rows: string[][]
  totalRows: number
  columnTypes: string[]
  alignments: string[]
}

function tableStringList(values: unknown[] | undefined) {
  return values?.map(tableCell) ?? []
}

function tableNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function tableData(part: OutputPart): RenderTableData | null {
  const table = parseJsonPart(part) as TablePayload | null
  const columns = table?.columns?.map(tableCell) ?? []
  const rows = table?.rows?.map((row) => row.map(tableCell)) ?? []
  const totalRows = tableNumber(table?.total_rows ?? table?.totalRows, rows.length)
  const columnTypes = tableStringList(table?.column_types ?? table?.columnTypes)
  const alignments = tableStringList(table?.alignments)
  return columns.length > 0 ? { columns, rows, totalRows, columnTypes, alignments } : null
}

function markdownTableCell(value: string) {
  return value.replace(/\r?\n/gu, ' ').replace(/\|/gu, '\\|')
}

function markdownAlignmentMarker(alignment: string | undefined) {
  return alignment === 'right' ? '---:' : '---'
}

function markdownTable(columns: string[], rows: string[][], alignments: string[]) {
  const header = `| ${columns.map(markdownTableCell).join(' | ')} |`
  const separator = `| ${columns.map((_, index) => markdownAlignmentMarker(alignments[index])).join(' | ')} |`
  const body = rows.map(
    (row) => `| ${columns.map((_, index) => markdownTableCell(row[index] ?? '')).join(' | ')} |`
  )
  return [header, separator, ...body].join('\n')
}

function tableFooter(data: RenderTableData, visibleRows: number, hidden: number, theme: Theme) {
  const shape = `${visibleRows}/${data.totalRows} rows · ${data.columns.length} columns`
  const types = data.columnTypes.length > 0 ? ` · ${data.columnTypes.join(', ')}` : ''
  const more = hidden > 0 ? ` · ${hidden} more` : ''
  return theme.fg('muted', shape + more + types)
}

function compactTableFooter(data: RenderTableData, visibleRows: number, theme: Theme) {
  const shape = `${visibleRows}/${data.totalRows} rows · ${data.columns.length} columns`
  const types = data.columnTypes.length > 0 ? ` · ${data.columnTypes.join(', ')}` : ''
  return theme.fg('muted', shape + types) + theme.fg('muted', ' · ') + expandHint(theme)
}

function compactTableCellWidth(columnCount: number, width: number) {
  const borderOverhead = 3 * columnCount + 1
  const availableForCells = Math.max(columnCount * 8, width - borderOverhead)
  return Math.max(8, Math.min(60, Math.floor(availableForCells / columnCount)))
}

function compactTableRows(rows: string[][], columnCount: number, width: number) {
  const cellWidth = compactTableCellWidth(columnCount, width)
  return rows.map((row) => row.map((cell) => truncateLine(cell, cellWidth)))
}

function compactContinuationRow(columnCount: number, hidden: number) {
  if (hidden <= 0) return []
  return Array.from({ length: columnCount }, (_, index) =>
    index === columnCount - 1 ? `… ${hidden} more rows` : ''
  )
}

function renderMarkdownTable(
  part: OutputPart,
  theme: Theme,
  options: { maxRows: number; expanded: boolean }
): Component | null {
  const data = tableData(part)
  if (!data) return null

  const visibleRows = data.rows.slice(0, options.maxRows)
  const hidden = Math.max(0, data.totalRows - visibleRows.length)
  return {
    render: (width) => {
      const rows = options.expanded
        ? visibleRows
        : [
            ...compactTableRows(visibleRows, data.columns.length, width),
            compactContinuationRow(data.columns.length, hidden)
          ].filter((row) => row.length > 0)
      const markdown = markdownTable(data.columns, rows, data.alignments)
      const lines = new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width)
      const footer = options.expanded
        ? tableFooter(data, visibleRows.length, hidden, theme)
        : compactTableFooter(data, visibleRows.length, theme)
      if (footer) lines.push('', footer)
      return ['', ...lines]
    },
    invalidate: () => undefined
  }
}

function treeKeyLabel(key: unknown) {
  return tableCell(key)
}

function renderTreeValue(value: unknown, theme: Theme, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const node = entry as TreeNode
      const key = treeKeyLabel(node.key)
      const child = node.value
      const last = index === value.length - 1
      const branch = last ? '└─ ' : '├─ '
      const childPrefix = prefix + (last ? '   ' : '│  ')
      const linePrefix = theme.fg('muted', prefix + branch)
      const label = theme.fg('muted', key + ':')
      if (Array.isArray(child))
        return [`${linePrefix}${label}`, ...renderTreeValue(child, theme, childPrefix)]
      return [`${linePrefix}${label} ${theme.fg('toolOutput', tableCell(child))}`]
    })
  }

  return [theme.fg('toolOutput', tableCell(value))]
}

function renderTreePart(part: OutputPart, theme: Theme): string[] | null {
  const tree = parseJsonPart(part)
  if (tree === null) return null
  return renderTreeValue(tree, theme).slice(0, 40)
}

function treeInspectPreview(part: OutputPart): string | undefined {
  return stringMetadata(part.data?.inspect_preview ?? part.data?.inspectPreview)
}

function hasGeneratedTreeTitle(part: OutputPart) {
  return stringMetadata(part.data?.title_kind ?? part.data?.titleKind) === 'generated'
}

function treeExpandLine(hidden: number, theme: Theme) {
  return hidden > 0 ? theme.fg('muted', `… ${hidden} more · `) + expandHint(theme) : undefined
}

function renderCompactTreePart(part: OutputPart, theme: Theme): Component | null {
  const tree = renderTreePart(part, theme)
  const inspectPreview = tree ? undefined : treeInspectPreview(part)
  if (!tree && !inspectPreview) return null

  return {
    render: (width) => {
      const maxLines = 6
      const rawLines = tree ?? highlightCode(stripFinalNewline(inspectPreview ?? ''), 'elixir')
      const shown = rawLines.slice(0, maxLines).map((line) => truncateLine(line, width))
      const hidden = rawLines.length - shown.length
      const title = partPreview(part)
      const titleLines = hasGeneratedTreeTitle(part) ? [] : [truncateLine(title, width)]
      const expand = treeExpandLine(hidden, theme)
      return ['', ...titleLines, ...shown, ...(expand ? [expand] : [])]
    },
    invalidate: () => undefined
  }
}

function renderOnlyTablePart(
  visibleParts: OutputPart[],
  expanded: boolean,
  theme: Theme
): Component | null {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (onlyPart?.kind !== 'table') return null
  return renderMarkdownTable(onlyPart, theme, { maxRows: expanded ? 20 : 1, expanded })
}

function highlightPayload(part: OutputPart): HighlightPayload | null {
  const highlight = part.data?.highlight
  if (typeof highlight !== 'object' || highlight === null) return null
  const payload = highlight as HighlightPayload
  return Array.isArray(payload.lines) ? payload : null
}

const rainbowThemeKeys = ['syntaxType', 'syntaxNumber', 'syntaxFunction', 'syntaxOperator'] as const

function rainbowSuffix(scope: string): string | undefined {
  if (scope.startsWith('rainbow-')) return scope.slice('rainbow-'.length)
  if (scope.startsWith('rainbow.')) return scope.slice('rainbow.'.length)
  return undefined
}

function rainbowIndex(scopes: string[]): number | undefined {
  for (const scope of scopes) {
    const suffix = rainbowSuffix(scope)
    if (suffix === undefined) continue

    const index = Number(suffix)
    if (Number.isInteger(index) && index > 0) return index - 1
  }
  return undefined
}

function syntaxColor(theme: Theme, color: Parameters<Theme['fg']>[0], text: string): string {
  return theme.fg(color, text)
}

function syntaxBold(theme: Theme, color: Parameters<Theme['fg']>[0], text: string): string {
  return theme.fg(color, theme.bold(text))
}

function styleScope(scopes: string[], theme: Theme, text: string): string {
  const rainbow = rainbowIndex(scopes)
  if (rainbow !== undefined && Number.isFinite(rainbow)) {
    return syntaxColor(theme, rainbowThemeKeys[Math.abs(rainbow) % rainbowThemeKeys.length], text)
  }

  const joined = scopes.join(' ')
  if (joined.includes('comment')) return syntaxColor(theme, 'syntaxComment', text)
  if (joined.includes('string-special-symbol')) return syntaxColor(theme, 'syntaxNumber', text)
  if (joined.includes('module') || joined.includes('constructor'))
    return syntaxBold(theme, 'syntaxType', text)
  if (joined.includes('function')) return syntaxColor(theme, 'syntaxFunction', text)
  if (joined.includes('keyword')) return syntaxBold(theme, 'syntaxKeyword', text)
  if (joined.includes('operator') || joined.includes('punctuation-special'))
    return syntaxColor(theme, 'syntaxOperator', text)
  if (joined.includes('string')) return syntaxColor(theme, 'syntaxString', text)
  if (joined.includes('number') || joined.includes('boolean') || joined.includes('constant'))
    return syntaxColor(theme, 'syntaxNumber', text)
  if (joined.includes('variable')) return syntaxColor(theme, 'syntaxVariable', text)
  if (joined.includes('punctuation')) return syntaxColor(theme, 'syntaxPunctuation', text)
  return theme.fg('toolOutput', text)
}

function highlightedBodyLines(part: OutputPart, theme: Theme): string[] | null {
  const highlight = highlightPayload(part)
  if (!highlight) return null

  return (
    highlight.lines?.map((line) =>
      line
        .map((span) => {
          const text = typeof span.text === 'string' ? span.text : ''
          const scopes = Array.isArray(span.scopes)
            ? span.scopes.filter((scope): scope is string => typeof scope === 'string')
            : []
          return styleScope(scopes, theme, text)
        })
        .join('')
    ) ?? null
  )
}

function highlightedCodeLines(part: OutputPart, theme: Theme, maxLines?: number): string[] | null {
  const lines = highlightedBodyLines(part, theme)
  if (!lines) return null
  const shown = typeof maxLines === 'number' ? lines.slice(0, maxLines) : lines
  const hidden = typeof maxLines === 'number' ? lines.length - shown.length : 0
  const rendered = shown.map((line) => `  ${line}`)
  const more = hiddenLine(hidden, theme)
  if (more) rendered.push(more)
  return rendered
}

function highlightedCodeFrameLines(
  part: OutputPart,
  theme: Theme,
  options: { startLine?: number; maxLines?: number; highlightLine?: number } = {}
): string[] | null {
  const lines = highlightedBodyLines(part, theme)
  return lines ? highlightedFrameLines(lines, theme, options) : null
}

function relativeSourcePath(path: string | undefined) {
  if (!path) return undefined
  const marker = '/packages/bridge/'
  const markerIndex = path.indexOf(marker)
  if (markerIndex >= 0) return path.slice(markerIndex + marker.length)
  return path
}

function sourceStartLine(part: OutputPart) {
  return numberMetadata(part.data?.start_line ?? part.data?.startLine) ?? 1
}

function sourceLocation(part: OutputPart) {
  const path = relativeSourcePath(
    stringMetadata(
      part.data?.source_path ?? part.data?.sourcePath ?? part.data?.source ?? part.data?.path
    )
  )
  const startLine = numberMetadata(part.data?.start_line ?? part.data?.startLine)
  const endLine = numberMetadata(part.data?.end_line ?? part.data?.endLine)
  if (!path || !startLine) return undefined
  return endLine && endLine !== startLine
    ? `${path}:${startLine}-${endLine}`
    : `${path}:${startLine}`
}

function sourceTitleText(part: OutputPart) {
  const subject = stringMetadata(part.data?.subject) ?? partPreview(part)
  const location = sourceLocation(part)
  return location ? `${subject} · ${location}` : subject
}

function sourceTitle(part: OutputPart, hidden: boolean, theme: Theme, width: number) {
  const title = sourceTitleText(part)
  if (!hidden) return truncateLine(title, width)

  const hint = inlineExpandHint(theme)
  if (visibleWidth(title + hint) <= width) return title + hint

  const reserve = visibleWidth(hint)
  return width > reserve + 4
    ? truncateLine(title, width - reserve) + hint
    : truncateLine(title, width)
}

function renderCompactSourcePart(part: OutputPart, theme: Theme): Component {
  return {
    render: (width) => {
      const output = stripFinalNewline(part.body ?? '')
      const maxLines = 6
      const totalLines = output ? output.split('\n').length : 0
      const hidden = totalLines > maxLines
      const lines =
        highlightedCodeFrameLines(part, theme, {
          startLine: sourceStartLine(part),
          maxLines
        }) ??
        codeFrameLines(output, part.language ?? 'elixir', theme, {
          startLine: sourceStartLine(part),
          maxLines
        })
      return ['', theme.fg('muted', sourceTitle(part, hidden, theme, width)), ...lines]
    },
    invalidate: () => undefined
  }
}

function renderOnlySourcePart(visibleParts: OutputPart[], expanded: boolean, theme: Theme) {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (expanded || onlyPart?.kind !== 'code') return null
  return renderCompactSourcePart(onlyPart, theme)
}

function renderOnlyTreePart(visibleParts: OutputPart[], expanded: boolean, theme: Theme) {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (expanded || onlyPart?.kind !== 'tree') return null
  return renderCompactTreePart(onlyPart, theme)
}

function compactHighlightedPreview(part: OutputPart, theme: Theme): string | null {
  const line = highlightedBodyLines(part, theme)?.[0]
  return line ?? null
}

function compactPartPreview(part: OutputPart, index: number, theme: Theme) {
  const text =
    part.kind === 'inspect'
      ? partPreview(part)
      : (compactHighlightedPreview(part, theme) ?? partPreview(part))
  const styled = part.kind === 'text' && index === 0 ? theme.fg('toolOutput', text) : text
  return index === 0 ? styled : theme.fg('muted', ` ↳ ${text}`)
}

function renderCompactOutputParts(visibleParts: OutputPart[], theme: Theme): Component {
  if (visibleParts.length > 1 && visibleParts[0]?.kind === 'text') {
    return renderCompactLine('', theme.fg('toolOutput', partPreview(visibleParts[0])), true, theme)
  }

  const preview = visibleParts.map((part, index) => compactPartPreview(part, index, theme)).join('')
  const semanticHidden = visibleParts.some(partHasSemanticHiddenOutput)
  return renderCompactLine('', preview, semanticHidden, theme)
}

function firstPartLines(lines: string[], index: number): string[] {
  if (index !== 0) return lines
  const [first, ...rest] = lines
  return [first?.trimStart() ?? '', ...rest]
}

function renderExpandedPart(part: OutputPart, index: number, theme: Theme): string[] {
  const output = stripFinalNewline(part.body ?? '')
  const kind = part.kind ?? 'text'

  switch (kind) {
    case 'table':
      return [theme.fg('toolOutput', output)]
    case 'tree':
      return renderTreePart(part, theme) ?? [theme.fg('toolOutput', output)]
    case 'inspect':
      return firstPartLines(
        highlightedCodeLines(part, theme) ?? codeLines(output, part.language ?? 'elixir', theme),
        index
      )
    case 'code':
      return (
        highlightedCodeFrameLines(part, theme, { startLine: sourceStartLine(part) }) ??
        codeFrameLines(output, part.language ?? 'elixir', theme, {
          startLine: sourceStartLine(part)
        })
      )
    case 'error':
      return [theme.fg('error', output)]
    default:
      return firstPartLines(
        output.split('\n').map((line) => `  ${theme.fg('toolOutput', line)}`),
        index
      )
  }
}

export function renderOutputParts(parts: OutputPart[], expanded: boolean, theme: Theme) {
  const visibleParts = parts.filter((part) => part.body)
  if (visibleParts.length === 0) return renderLines([theme.fg('muted', '(no output)')])

  const table = renderOnlyTablePart(visibleParts, expanded, theme)
  if (table) return table

  const document = renderWebDocument(visibleParts, expanded, theme)
  if (document) return document

  const source = renderOnlySourcePart(visibleParts, expanded, theme)
  if (source) return source

  const tree = renderOnlyTreePart(visibleParts, expanded, theme)
  if (tree) return tree

  if (!expanded) return renderCompactOutputParts(visibleParts, theme)

  const lines = visibleParts.flatMap((part, index) => [
    ...(index > 0 ? [''] : []),
    ...renderExpandedPart(part, index, theme)
  ])
  return renderLines(lines)
}
