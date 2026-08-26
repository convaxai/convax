import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { REPOSITORY_ROOT } from './profile-runtime.mjs'

const action = process.argv[2]
const argumentsByAction = {
  version: ['--version'],
  install: ['install', '--frozen-lockfile'],
  build: ['run', 'build'],
}
const args = argumentsByAction[action]
if (args === undefined) {
  process.stderr.write('usage: node app/scripts/upstream-command.mjs <version|install|build>\n')
  process.exit(2)
}

const upstream = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'upstream.json'), 'utf8'))
const sourceCheckout = resolve(REPOSITORY_ROOT, upstream.sourceCheckout)
if (!existsSync(join(sourceCheckout, '.git'))) {
  process.stderr.write(`optional upstream source checkout is missing: ${sourceCheckout}\n`)
  process.stderr.write(`clone ${upstream.repository} there and checkout ${upstream.commit}\n`)
  process.exit(1)
}

const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: sourceCheckout,
  encoding: 'utf8',
})
if (revision.error !== undefined) throw revision.error
const actualCommit = revision.stdout.trim()
if (revision.status !== 0 || actualCommit !== upstream.commit) {
  process.stderr.write(`upstream source checkout mismatch: expected ${upstream.commit}, got ${actualCommit || 'unknown'}\n`)
  process.exit(1)
}

const result = spawnSync('corepack', ['pnpm', ...args], {
  cwd: sourceCheckout,
  env: {
    ...process.env,
    // The optional sibling checkout is audit input, never a product dependency.
    CI: 'true',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
