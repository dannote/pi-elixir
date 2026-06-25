import { readFileSync } from 'node:fs'

function readExtensionVersion(): string {
  const packageJsonUrl = new URL('../../../package.json', import.meta.url)
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string }
  return packageJson.version ?? '0.0.0'
}

export const EXTENSION_VERSION = readExtensionVersion()
