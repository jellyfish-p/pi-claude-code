const fs=require('fs'), path=require('path')
const {spawnSync}=require('child_process')
const ROOT=process.env.CC_WORK||path.join(__dirname,'..','..','.work'), CL=path.join(ROOT,'bin/package/claude.exe')
const SKILLS=['claude-api','fewer-permission-prompts','keybindings-help','loop','update-config','dataviz','init','plugin-authoring','run','security-review','simplify','workflow-authoring']
const exps = [{run:'skip-default', prompt:'hi', steps:[{blocks:[{type:'text',text:'ok'}]}]}]
for (const s of SKILLS) exps.push({run:`sd-skill-${s}`, prompt:`Use the ${s} skill.`, steps:[
  {blocks:[{type:'tool_use',name:'Skill',input:{skill:s}}]},
  {blocks:[{type:'text',text:'ok'}]},{blocks:[{type:'text',text:'ok'}]},
]})
for (const e of exps) {
  fs.writeFileSync(path.join(__dirname,'scenario.json'), JSON.stringify({run:e.run,steps:e.steps},null,1))
  const env={...process.env, ANTHROPIC_BASE_URL:process.env.CC_MOCK||'http://127.0.0.1:8790', ANTHROPIC_API_KEY:'sk-ant-api03-dummy',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1', DISABLE_TELEMETRY:'1', DISABLE_AUTOUPDATER:'1',
    HOME:path.join(ROOT,'home'), USERPROFILE:path.join(ROOT,'home')}
  const r=spawnSync(CL,['--print',e.prompt,'--dangerously-skip-permissions'],{cwd:path.join(ROOT,'scratch'),env,encoding:'utf8',timeout:90000})
  console.log(`${e.run}: exit=${r.status} ${(r.stdout||'').trim().slice(0,60)}`)
}
