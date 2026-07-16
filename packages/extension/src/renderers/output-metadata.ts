export function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export function booleanMetadata(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
