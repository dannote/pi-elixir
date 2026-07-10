import {
  BRIDGE_PROTOCOL_VERSION,
  EXPECTED_BRIDGE_BUILD,
  REQUIRED_BRIDGE_CAPABILITIES,
  bridgeHandshakeProblem
} from '#src/version.ts'
import { describe, expect, it } from 'vitest'

const validInfo = {
  build: EXPECTED_BRIDGE_BUILD,
  protocol: BRIDGE_PROTOCOL_VERSION,
  capabilities: [...REQUIRED_BRIDGE_CAPABILITIES]
}

describe('bridge startup contract', () => {
  it('accepts only the expected build, protocol, and capabilities', () => {
    expect(bridgeHandshakeProblem(validInfo)).toBeNull()
    expect(bridgeHandshakeProblem(undefined)).toContain('startup information')
    expect(bridgeHandshakeProblem({ ...validInfo, protocol: 1 })).toContain('protocol mismatch')
    expect(bridgeHandshakeProblem({ ...validInfo, build: 'stale' })).toContain('build mismatch')
    expect(bridgeHandshakeProblem({ ...validInfo, capabilities: ['stdio_jsonl'] })).toContain(
      'missing required capabilities'
    )
  })
})
