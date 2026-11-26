// Compatibility entry: default + all skill probes with explicit permission bypass.
import { main } from './capture.mjs'
const args = process.argv.slice(2)
const only = args[0] && !args[0].startsWith('--') ? args.shift() : null
try { await main(['--profile', 'skills-permissive', ...(only ? ['--only', only] : []), ...args]) }
catch (error) { console.error(error.message); process.exitCode = 1 }
