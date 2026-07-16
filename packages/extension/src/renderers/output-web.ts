import { getMarkdownTheme, type Theme } from '@earendil-works/pi-coding-agent'
import { Markdown, visibleWidth, type Component } from '@earendil-works/pi-tui'

import { truncateLine } from '../helpers.ts'
import { booleanMetadata, numberMetadata, stringMetadata } from './output-metadata.ts'
import type { OutputPart } from './output-types.ts'
import { codeLines, expandHint, stripFinalNewline } from './shared.ts'

function formatBytes(value: number | undefined) {
  if (value === undefined) return undefined
  if (value < 1024) return `${value} B`

  const units = ['KB', 'MB', 'GB']
  let size = value / 1024

  for (const unit of units) {
    if (size < 1024 || unit === units[units.length - 1]) return `${size.toFixed(1)} ${unit}`
    size /= 1024
  }

  return `${value} B`
}

function statusLabel(status: number | undefined) {
  if (status === undefined) return '?'
  if (status >= 200 && status < 300) return `${status} OK`
  if (status >= 300 && status < 400) return `${status} redirect`
  if (status >= 400 && status < 500) return `${status} client error`
  if (status >= 500) return `${status} server error`
  return String(status)
}

function documentKind(part: OutputPart) {
  return stringMetadata(part.data?.document_kind ?? part.data?.documentKind)
}

function webFetchMetaLine(part: OutputPart) {
  const status = statusLabel(numberMetadata(part.data?.status))
  const contentType = stringMetadata(part.data?.content_type ?? part.data?.contentType)
  const bytes = formatBytes(numberMetadata(part.data?.size_bytes ?? part.data?.sizeBytes))
  return ['Web fetch', status, contentType, bytes].filter(Boolean).join(' · ')
}

function webFetchUrlLines(part: OutputPart) {
  const url = stringMetadata(part.data?.url)
  const finalUrl = stringMetadata(part.data?.final_url ?? part.data?.finalUrl)
  const redirected = booleanMetadata(part.data?.redirected) || (url && finalUrl && url !== finalUrl)
  if (!url) return []
  if (redirected && finalUrl) return [url, `→ ${finalUrl}`]
  return [url]
}

function webFetchFooterText(part: OutputPart) {
  const chars = numberMetadata(part.data?.total_chars ?? part.data?.totalChars)
  const truncated = booleanMetadata(part.data?.truncated) === true
  return `${chars ?? visibleWidth(part.body ?? '')} chars · ${truncated ? 'truncated' : 'not truncated'}`
}

function compactWebBodyLines(part: OutputPart, title: string | undefined) {
  const lines = stripFinalNewline(part.body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const bodyLines = title
    ? lines.filter((line) => line !== title && line !== `${title} ${title}`)
    : lines

  return bodyLines.slice(0, 1)
}

function renderCompactWebFetchPart(part: OutputPart, theme: Theme): Component {
  return {
    render: (width) => {
      const title = stringMetadata(part.data?.title)
      const shownBody = compactWebBodyLines(part, title)
      return [
        '',
        theme.fg('muted', truncateLine(webFetchMetaLine(part), width)),
        ...webFetchUrlLines(part).map((line) => theme.fg('muted', truncateLine(line, width))),
        ...(title
          ? [theme.fg('muted', '→ ') + theme.fg('toolOutput', truncateLine(title, width - 2))]
          : []),
        ...shownBody.map((line) => theme.fg('toolOutput', truncateLine(line, width))),
        theme.fg('muted', webFetchFooterText(part)) + theme.fg('muted', ' · ') + expandHint(theme)
      ]
    },
    invalidate: () => undefined
  }
}

function metadataRow(
  label: string,
  value: string | number | boolean | undefined | null,
  theme: Theme
) {
  if (value === undefined || value === null || value === '') return undefined
  return `${theme.fg('muted', label.padEnd(13))} ${theme.fg('toolOutput', String(value))}`
}

function sectionHeader(label: string, theme: Theme) {
  const muted = theme.fg('muted', label)
  const bold = (theme as Theme & { bold?: (text: string) => string }).bold
  return bold ? bold(muted) : muted
}

function yesNo(value: boolean | undefined) {
  return value ? 'yes' : 'no'
}

function webFetchExpandedHeader(part: OutputPart, format: string, theme: Theme) {
  return [
    '',
    sectionHeader('Web fetch', theme),
    metadataRow('Status:', statusLabel(numberMetadata(part.data?.status)), theme),
    metadataRow('URL:', stringMetadata(part.data?.url), theme),
    metadataRow('Final URL:', stringMetadata(part.data?.final_url ?? part.data?.finalUrl), theme),
    metadataRow(
      'Content-Type:',
      stringMetadata(part.data?.content_type ?? part.data?.contentType),
      theme
    ),
    metadataRow('Format:', format, theme),
    metadataRow(
      'Size:',
      formatBytes(numberMetadata(part.data?.size_bytes ?? part.data?.sizeBytes)),
      theme
    ),
    metadataRow('Chars:', numberMetadata(part.data?.total_chars ?? part.data?.totalChars), theme),
    metadataRow('Redirected:', yesNo(booleanMetadata(part.data?.redirected)), theme),
    metadataRow('Truncated:', yesNo(booleanMetadata(part.data?.truncated)), theme)
  ].filter((line): line is string => line !== undefined)
}

function webFetchExpandedBodyLines(output: string, format: string, width: number, theme: Theme) {
  if (format === 'markdown') return new Markdown(output, 0, 0, getMarkdownTheme()).render(width)
  if (format === 'json' || format === 'html') return codeLines(output, format, theme)
  return output.split('\n').map((line) => theme.fg('toolOutput', line))
}

function webFetchExpandedBodyHeader(part: OutputPart, theme: Theme) {
  const title = stringMetadata(part.data?.title)
  return title
    ? [
        '',
        sectionHeader('Title', theme),
        theme.fg('toolOutput', title),
        '',
        sectionHeader('Body', theme)
      ]
    : ['', sectionHeader('Body', theme)]
}

function renderExpandedWebFetchPart(part: OutputPart, theme: Theme): Component {
  return {
    render: (width) => {
      const output = stripFinalNewline(part.body ?? '')
      const format = stringMetadata(part.data?.format) ?? part.language ?? 'text'
      return [
        ...webFetchExpandedHeader(part, format, theme),
        ...webFetchExpandedBodyHeader(part, theme),
        ...webFetchExpandedBodyLines(output, format, width, theme)
      ]
    },
    invalidate: () => undefined
  }
}

export function renderWebDocument(
  visibleParts: OutputPart[],
  expanded: boolean,
  theme: Theme
): Component | null {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (onlyPart?.kind !== 'document' || documentKind(onlyPart) !== 'web_fetch') return null
  return expanded
    ? renderExpandedWebFetchPart(onlyPart, theme)
    : renderCompactWebFetchPart(onlyPart, theme)
}
