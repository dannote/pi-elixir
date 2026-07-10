import { readFileSync } from 'node:fs'

import type { BridgeInfo } from '#src/protocol/types.ts'

function readExtensionVersion(): string {
  const packageJsonUrl = new URL('../../../package.json', import.meta.url)
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string }
  return packageJson.version ?? '0.0.0'
}

export const EXTENSION_VERSION = readExtensionVersion()
export const BRIDGE_PROTOCOL_VERSION = 2
export const EXPECTED_BRIDGE_BUILD = `pi_bridge@${EXTENSION_VERSION}/protocol-${BRIDGE_PROTOCOL_VERSION}`
export const REQUIRED_BRIDGE_CAPABILITIES = [
  'stdio_jsonl',
  'bridge_requests',
  'project_eval_worker',
  'application_eval_worker',
  'attached_runtime_eval',
  'structured_diagnostics',
  'project_context'
] as const

export function bridgeHandshakeProblem(info: BridgeInfo | undefined): string | null {
  if (!info) return 'Bridge ready event did not include startup information.'
  if (info.protocol !== BRIDGE_PROTOCOL_VERSION) {
    return `Bridge protocol mismatch: received ${info.protocol ?? 'unknown'}, expected ${BRIDGE_PROTOCOL_VERSION}.`
  }
  if (info.build !== EXPECTED_BRIDGE_BUILD) {
    return `Bridge build mismatch: received ${info.build ?? 'unknown'}, expected ${EXPECTED_BRIDGE_BUILD}.`
  }

  const capabilities = new Set(info.capabilities ?? [])
  const missing = REQUIRED_BRIDGE_CAPABILITIES.filter((capability) => !capabilities.has(capability))
  if (missing.length > 0) return `Bridge is missing required capabilities: ${missing.join(', ')}.`

  return null
}
