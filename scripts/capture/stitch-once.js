const fs = require('fs')
const path = require('path')
const EXE = process.env.CC_BIN || path.join(__dirname, '..', '..', '.work', 'bin/package/claude.exe')
const fd = fs.openSync(EXE, 'r')
const size = fs.fstatSync(fd).size
const isText = (c) => c === 9 || c === 10 || c === 13 || c >= 32
const readAt = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b }

function stitch(start, maxLen = 60000) {
  let off = start, out = '', gaps = 0
  while (off < size && out.length < maxLen) {
    const chunk = readAt(off, 1 << 16).toString('latin1')
    let i = 0
    for (; i < chunk.length; i++) if (!isText(chunk.charCodeAt(i))) break
    out += chunk.slice(0, i)
    off += i
    if (i < chunk.length) {
      let g = 0
      while (g < 32) { if (isText(readAt(off + g, 1)[0])) break; g++ }
      if (g === 0 || g > 16) break
      off += g; gaps++
      if (gaps > 800) break
      continue
    }
  }
  return out
}

const unesc = (raw) => raw
  .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'")
  .replace(/\\\\/g, '\\').replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\`/g, '`').replace(/\\\$/g, '$')

const targets = [
  { name: 'gated-todowrite', start: 159092320, cut: '</example>' },
]
for (const t of targets) {
  const txt = unesc(stitch(t.start))
  const i = txt.lastIndexOf(t.cut)
  const body = i > 0 ? txt.slice(0, i + t.cut.length) : txt
  fs.writeFileSync(path.join(__dirname, '..', 'facts', t.name + '.md'), body + '\n')
  console.log(t.name, body.length, JSON.stringify(body.slice(-120)))
}
