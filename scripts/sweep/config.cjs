// Shared settings for the sweep scripts. Passwords come from .env.sweep.local (git-ignored: the repo is public).
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const envFile = path.join(root, '.env.sweep.local')
const env = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  : {}
const need = (key) => {
  const v = process.env[key] ?? env[key]
  if (!v) throw new Error(`Missing ${key}: add it to .env.sweep.local (see scripts/sweep/README.md)`)
  return v
}

module.exports = {
  // playwright-core: installed with the playwright-cli tool, not in package.json (no new dependency for a dev check).
  playwright: require(process.env.SWEEP_PLAYWRIGHT ?? env.SWEEP_PLAYWRIGHT ?? 'playwright-core'),
  SITE: process.env.SWEEP_SITE ?? env.SWEEP_SITE ?? 'https://touqproject.ahmadhfatani.workers.dev',
  OUT: (() => { const d = path.join(__dirname, 'out') + path.sep; fs.mkdirSync(d, { recursive: true }); return d.replace(/\\/g, '/') })(),
  SPSQL: path.join(__dirname, 'spsql.cjs'),
  PASS: {
    get demoStaff() { return need('SWEEP_DEMO_STAFF_PASSWORD') },
    get cofounder() { return need('SWEEP_COFOUNDER_PASSWORD') },
    get admin() { return need('SWEEP_ADMIN_PASSWORD') },
    get eastMgr() { return need('SWEEP_EAST_MGR_PASSWORD') },
    get sweepNurse() { return need('SWEEP_TEST_NURSE_PASSWORD') },
  },
}
