import { highlightCode } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'

export function renderElixirResult(result: any, _options: any, _theme: any) {
  const text = result.content?.[0]?.text ?? ''
  if (!text || result.isError) return new Text(text, 0, 0)
  return new Text(highlightCode(text, 'elixir').join('\n'), 0, 0)
}

export function renderMarkdownResult(result: any, _options: any, theme: any) {
  const text = result.content?.[0]?.text ?? ''
  if (!text || result.isError) return new Text(text, 0, 0)

  const lines: string[] = []
  let inCodeBlock = false
  let codeLang = ''
  let codeBuffer: string[] = []

  for (const line of text.split('\n')) {
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch && !inCodeBlock) {
      inCodeBlock = true
      codeLang = fenceMatch[1] || 'elixir'
      codeBuffer = []
    } else if (line.startsWith('```') && inCodeBlock) {
      lines.push(...highlightCode(codeBuffer.join('\n'), codeLang))
      inCodeBlock = false
    } else if (inCodeBlock) {
      codeBuffer.push(line)
    } else if (line.startsWith('# ')) {
      lines.push(theme.fg('accent', theme.bold(line)))
    } else if (line.startsWith('## ') || line.startsWith('### ')) {
      lines.push(theme.fg('accent', line))
    } else {
      lines.push(line)
    }
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    lines.push(...highlightCode(codeBuffer.join('\n'), codeLang))
  }

  return new Text(lines.join('\n'), 0, 0)
}

export function renderSqlResult(result: any, _options: any, _theme: any) {
  const text = result.content?.[0]?.text ?? ''
  if (!text || result.isError) return new Text(text, 0, 0)
  return new Text(highlightCode(text, 'elixir').join('\n'), 0, 0)
}

export function renderLogResult(result: any, _options: any, theme: any) {
  const text = result.content?.[0]?.text ?? ''
  if (!text || result.isError) return new Text(text, 0, 0)

  const lines = text.split('\n').map((line: string) => {
    if (/\[error\]/i.test(line)) return theme.fg('error', line)
    if (/\[warn(ing)?\]/i.test(line)) return theme.fg('warning', line)
    if (/\[debug\]/i.test(line)) return theme.fg('dim', line)
    return line
  })

  return new Text(lines.join('\n'), 0, 0)
}
