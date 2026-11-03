const fs=require('fs'), path=require('path')
const REQ=path.join(__dirname,'requests')
for (const run of fs.readdirSync(REQ).sort()) {
  const files = fs.readdirSync(path.join(REQ,run)).sort()
  console.log(`\n### ${run}`)
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(REQ,run,f),'utf8'))
    const sys = (j.system||[]).map(s=>(s.text||'').length)
    const last = j.messages[j.messages.length-1]
    const lastTypes = Array.isArray(last.content)? last.content.map(c=>c.type+(c.name?'/'+c.name:'')+(c.tool_use_id?'/res':'')).join(',') : 'str'
    console.log(`  ${f} tools=${(j.tools||[]).map(t=>t.name).length} sys=${JSON.stringify(sys)} last=${lastTypes}`)
  }
}
