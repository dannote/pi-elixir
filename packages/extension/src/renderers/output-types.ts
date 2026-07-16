export interface OutputPart {
  kind?: string
  body?: string
  language?: string | null
  title?: string | null
  data?: Record<string, unknown> | null
}
