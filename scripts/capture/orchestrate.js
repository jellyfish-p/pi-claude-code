// Compatibility entry: all ordinary-permission skill and agent probes.
import { main } from './capture.mjs'
const args = process.argv.slice(2)
const only = args[0] && !args[0].startsWith('--') ? args.shift() : null
try { await main(['--profile', 'legacy', ...(only ? ['--only', only] : []), ...args]) }
catch (error) { console.error(error.message); process.exitCode = 1 }
