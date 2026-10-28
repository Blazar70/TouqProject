// Run psql against STAGING only. Usage: node spsql.cjs -f file.sql | -c "sql"
const fs = require('fs')
const { spawnSync } = require('child_process')
const root = require('path').resolve(__dirname, '../..')
const env = fs.readFileSync(root + '/.env.staging.local', 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
let url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
if (!url.includes('epsnbhxlpxlcqwtzbofq')) throw new Error('not staging')
const m = url.match(/^(postgres(?:ql)?:\/\/[^:]+:)(.*)(@[^@]+)$/)
url = m[1] + encodeURIComponent(decodeURIComponent(m[2])) + m[3]
const r = spawnSync('C:/Program Files/PostgreSQL/17/bin/psql.exe', [url, '-v', 'ON_ERROR_STOP=1', '-X', ...process.argv.slice(2)], { stdio: 'inherit', cwd: root })
process.exit(r.status)
