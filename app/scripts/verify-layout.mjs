import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import { REPOSITORY_ROOT } from './profile-runtime.mjs'

function fail(message) {
  throw new Error(`layout gate: ${message}`)
}

const upstream = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'upstream.json'), 'utf8'))
const repositoryEntries = new Set(readdirSync(REPOSITORY_ROOT))
for (const forbiddenEntry of ['.gitmodules', 'deepseek-harness']) {
  if (repositoryEntries.has(forbiddenEntry)) {
    fail(`${forbiddenEntry} must stay outside the product repository`)
  }
}
if (upstream.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git') {
  fail('unexpected upstream source repository')
}
if (!/^[0-9a-f]{40}$/.test(upstream.commit)) fail('upstream source commit must be a full SHA')
if (upstream.sourceCheckout !== '../deepseek-harness') {
  fail('optional upstream source checkout must be the sibling ../deepseek-harness')
}

const rootManifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'))
if (rootManifest.dependencies?.['@deepseek-ai/dsh'] !== upstream.version) fail('npm DSH runtime is not pinned to upstream version')

const desktopManifestPath = join(REPOSITORY_ROOT, 'app', 'desktop', 'package.json')
if (!existsSync(desktopManifestPath)) fail('desktop package is missing')
const desktop = JSON.parse(readFileSync(desktopManifestPath, 'utf8'))
const allDesktopDeps = { ...desktop.dependencies, ...desktop.devDependencies }
if (allDesktopDeps.electron !== '43.4.0') fail('Electron must be exactly 43.4.0')
if (allDesktopDeps['node-bin-darwin-arm64'] !== '24.9.0') {
  fail('packaged Darwin ARM64 Node must be exactly 24.9.0')
}
if (allDesktopDeps.node !== undefined) fail('generic node installer package is forbidden')
if (desktop.build?.asar !== false) {
  fail('M1 external Node runtime must not live under an app.asar path')
}

const lock = YAML.parse(readFileSync(join(REPOSITORY_ROOT, 'yarn.lock'), 'utf8'))
const dshResolutions = Object.values(lock)
  .filter(entry => entry !== null
    && typeof entry === 'object'
    && typeof entry.resolution === 'string'
    && entry.resolution.startsWith('@deepseek-ai/dsh'))
  .map(entry => entry.resolution)
const driftingDsh = dshResolutions.filter(resolution => !resolution.endsWith(`@npm:${upstream.version}`))
if (dshResolutions.length < 100 || driftingDsh.length !== 0) {
  fail(`DSH npm closure drifted from ${upstream.version}: ${driftingDsh.join(', ')}`)
}

const patchFiles = readdirSync(join(REPOSITORY_ROOT, 'patches')).filter(name => name.endsWith('.patch'))
if (patchFiles.length !== 0 || upstream.patches.length !== 0) fail('M1 patch inventory must remain empty')

for (const path of [
  'app/profiles/compatibility/cordis.patch.yml',
  'app/profiles/default/cordis.patch.yml',
  'app/profiles/security.patch.yml',
]) {
  const raw = readFileSync(join(REPOSITORY_ROOT, path), 'utf8')
  if (raw.includes('!!js') || raw.includes('__jsExpr')) fail(`${path} contains executable YAML`)
}

process.stdout.write('layout gate: external upstream reference, runtime versions, patches, and config purity pass\n')
