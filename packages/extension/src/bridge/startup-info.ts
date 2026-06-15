import type { BridgeInfo } from '#src/embedded/stdio-process.ts'
import { detectElixirVersion, shouldRecommendElixir120 } from '#src/mix/runtime.ts'
import { EXTENSION_VERSION } from '#src/version.ts'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

export function renderStartupInfo(info: BridgeInfo) {
  const lines = [
    'pi_bridge',
    `  project: ${info.project ?? 'unknown'}`,
    `  pi_bridge: ${info.version ?? 'unknown'} (extension ${EXTENSION_VERSION})`,
    `  transport: ${info.transport ?? 'unknown'}`,
    `  executable skills: ${info.skills?.length ?? 0}`,
    `  plugins: ${info.plugins?.length ?? 0}`
  ]

  return lines.join('\n')
}

export function startupElixirVersionRecommendation(cwd: string): string | null {
  const version = detectElixirVersion(cwd)
  if (!shouldRecommendElixir120(version)) return null

  return `${version?.raw ?? 'Current Elixir'} detected. pi_bridge supports Elixir 1.16+ for legacy projects, but Elixir 1.20+ with OTP 27+ is recommended for new projects because it adds the compiler set-theoretic type system, whole-body type inference, occurrence typing, and richer map typing.`
}

export function showStartupInfo(ctx: ExtensionContext, info: BridgeInfo | undefined, cwd: string) {
  const recommendation = startupElixirVersionRecommendation(cwd)
  if (recommendation) ctx.ui.notify(recommendation, 'warning')

  if (!info) return
  ctx.ui.notify(renderStartupInfo(info), 'info')
}
