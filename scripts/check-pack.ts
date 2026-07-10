#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent'
import { packlist } from '@pnpm/fs.packlist'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>

const bridgeVersion = execFileSync(
  'mix',
  ['run', '--no-start', '--no-compile', '-e', 'IO.write(Mix.Project.config()[:version])'],
  {
    cwd: path.join(root, 'packages/bridge'),
    encoding: 'utf8'
  }
).trim()
const files = new Set(await packlist(root, { manifest: packageJson }))

const requiredFiles = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'packages/extension/src/index.ts',
  'packages/extension/scripts/embedded_server.exs',
  'packages/extension/skills/elixir/SKILL.md',
  'packages/extension/skills/elixir-web/SKILL.md',
  'packages/extension/skills/elixir-new-project/SKILL.md',
  'packages/bridge/mix.exs',
  'packages/bridge/README.md',
  'packages/bridge/docs/protocol.md',
  'packages/bridge/lib/pi/session.ex',
  'packages/bridge/lib/pi/session/worker.ex',
  'packages/bridge/lib/pi/transport/stdio.ex'
] as const

const forbiddenPatterns = [
  /^packages\/extension\/test\//,
  /^packages\/bridge\/test\//,
  /^packages\/bridge\/deps\//,
  /^packages\/bridge\/_build\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.worktrees\//,
  /^pnpm-lock\.yaml$/,
  /^bun\.lock$/
] as const

const requiredMetadata = [
  ['name', 'pi-elixir'],
  ['pi.extensions.0', './packages/extension/src/index.ts'],
  ['pi.skills.0', './packages/extension/skills']
] as const

function getPath(object: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined
    return (value as Record<string, unknown>)[key]
  }, object)
}

const missing = requiredFiles.filter((file) => !files.has(file))
const forbidden = [...files].filter((file) =>
  forbiddenPatterns.some((pattern) => pattern.test(file))
)
const metadataErrors = requiredMetadata.flatMap(([keyPath, expected]) => {
  const actual = getPath(packageJson, keyPath)
  return actual === expected ? [] : [`${keyPath}: expected ${expected}, got ${String(actual)}`]
})
const loadedSkills = loadSkillsFromDir({
  dir: path.join(root, 'packages/extension/skills'),
  source: 'pi-elixir package'
})
const expectedSkillNames = new Set(['elixir', 'elixir-web', 'elixir-new-project'])
const discoveredSkillNames = new Set(loadedSkills.skills.map((skill) => skill.name))
const skillErrors = [
  ...loadedSkills.diagnostics.map(
    (diagnostic) => `${diagnostic.path ?? '(skills)'}: ${diagnostic.message}`
  ),
  ...loadedSkills.skills.flatMap((skill) => {
    const directory = path.basename(skill.baseDir)
    return skill.name === directory
      ? []
      : [`${skill.filePath}: directory ${directory} does not match name ${skill.name}`]
  }),
  ...[...expectedSkillNames]
    .filter((name) => !discoveredSkillNames.has(name))
    .map((name) => `missing packaged skill: ${name}`),
  ...[...discoveredSkillNames]
    .filter((name) => !expectedSkillNames.has(name))
    .map((name) => `unexpected packaged skill: ${name}`)
]

if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
  metadataErrors.push(`version: expected non-empty string, got ${String(packageJson.version)}`)
}
if (bridgeVersion !== packageJson.version) {
  metadataErrors.push(
    `version mismatch: package.json has ${String(packageJson.version)}, packages/bridge/mix.exs has ${String(bridgeVersion)}`
  )
}

const bridgeCount = [...files].filter((file) => file.startsWith('packages/bridge/lib/')).length
const extensionCount = [...files].filter((file) =>
  file.startsWith('packages/extension/src/')
).length

if (missing.length || forbidden.length || metadataErrors.length || skillErrors.length) {
  if (missing.length) console.error('Missing required pack files:\n' + missing.join('\n'))
  if (forbidden.length) console.error('Forbidden files in pack:\n' + forbidden.join('\n'))
  if (metadataErrors.length)
    console.error('Invalid package metadata:\n' + metadataErrors.join('\n'))
  if (skillErrors.length) console.error('Invalid packaged skills:\n' + skillErrors.join('\n'))
  process.exit(1)
}

console.log(
  `Packlist ok: ${files.size} files, ${bridgeCount} bridge lib files, ${extensionCount} extension src files`
)
