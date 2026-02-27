import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mariozechner/pi-coding-agent', () => ({
  DEFAULT_MAX_LINES: 2000,
  DEFAULT_MAX_BYTES: 50 * 1024,
  formatSize: (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    return `${(bytes / 1024).toFixed(1)}KB`
  },
  truncateHead: vi.fn()
}))

vi.mock('../extensions/tidewave-client.ts', () => ({}))

import { truncateHead } from '@mariozechner/pi-coding-agent'

import { truncated, formatHexSearchResults } from '../extensions/helpers.ts'

const mockTruncateHead = vi.mocked(truncateHead)

describe('truncated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns text unchanged when not truncated', () => {
    mockTruncateHead.mockReturnValue({
      content: 'hello world',
      truncated: false,
      truncatedBy: null,
      totalLines: 1,
      totalBytes: 11,
      outputLines: 1,
      outputBytes: 11,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines: 2000,
      maxBytes: 50 * 1024
    })

    expect(truncated('hello world')).toBe('hello world')
  })

  it('appends truncation notice when truncated', () => {
    mockTruncateHead.mockReturnValue({
      content: 'first line',
      truncated: true,
      truncatedBy: 'lines',
      totalLines: 5000,
      totalBytes: 100_000,
      outputLines: 2000,
      outputBytes: 40_000,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines: 2000,
      maxBytes: 50 * 1024
    })

    const result = truncated('some very long text')
    expect(result).toBe('first line\n\n[Truncated: 2000/5000 lines, 39.1KB/97.7KB]')
  })
})

describe('formatHexSearchResults', () => {
  it('returns raw text when no result tags found', () => {
    const raw = 'No results found for query'
    expect(formatHexSearchResults(raw)).toBe(raw)
  })

  it('formats results with titles, URLs, and content', () => {
    const raw = [
      'Results: 2',
      '',
      '<result index="1" package="phoenix" ref="Phoenix.Controller.html#render/2" title="Phoenix.Controller.render/2">',
      'Renders the given template or view.',
      '</result>',
      '',
      '<result index="2" package="ecto" ref="Ecto.Query.html#from/2" title="Ecto.Query.from/2">',
      'Creates a query from a schema.',
      '</result>'
    ].join('\n')

    const result = formatHexSearchResults(raw)

    expect(result).toContain('2 results')
    expect(result).toContain('### Phoenix.Controller.render/2')
    expect(result).toContain('https://hexdocs.pm/phoenixPhoenix.Controller.html#render/2')
    expect(result).toContain('Renders the given template or view.')
    expect(result).toContain('### Ecto.Query.from/2')
    expect(result).toContain('https://hexdocs.pm/ectoEcto.Query.html#from/2')
    expect(result).toContain('Creates a query from a schema.')
  })

  it('extracts count from Results: N prefix', () => {
    const raw = [
      'Results: 1',
      '',
      '<result index="1" package="plug" ref="Plug.Conn.html" title="Plug.Conn">',
      'The connection struct.',
      '</result>'
    ].join('\n')

    const result = formatHexSearchResults(raw)
    expect(result).toMatch(/^1 results/)
  })

  it('uses ? when count prefix is missing', () => {
    const raw = [
      '<result index="1" package="plug" ref="Plug.Conn.html" title="Plug.Conn">',
      'The connection struct.',
      '</result>'
    ].join('\n')

    const result = formatHexSearchResults(raw)
    expect(result).toMatch(/^\? results/)
  })

  it('separates multiple results with horizontal rules', () => {
    const raw = [
      'Results: 2',
      '',
      '<result index="1" package="phoenix" ref="a.html" title="A">',
      'First.',
      '</result>',
      '',
      '<result index="2" package="phoenix" ref="b.html" title="B">',
      'Second.',
      '</result>'
    ].join('\n')

    const result = formatHexSearchResults(raw)
    expect(result).toContain('---')
  })

  it('converts package with dash suffix to hexdocs URL path', () => {
    const raw = [
      'Results: 1',
      '',
      '<result index="1" package="phoenix_live_view-0.20.0" ref="Phoenix.LiveView.html" title="Phoenix.LiveView">',
      'LiveView docs.',
      '</result>'
    ].join('\n')

    const result = formatHexSearchResults(raw)
    expect(result).toContain('https://hexdocs.pm/phoenix_live_view/0.20.0/Phoenix.LiveView.html')
  })
})
