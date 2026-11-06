import { useEffect, useMemo, useState } from 'react'

type Workflow = {id:number;name:string;status:string;conclusion:string|null;updated_at:string;html_url:string;head_sha:string}
type Issue = {number:number;title:string;state:string;updated_at:string;html_url:string;labels:string[]}
type Ops = {source:string;executionEnabled:boolean;updatedAt:string;warning:string;commit:{sha:string|null;message:string|null};runs:Workflow[];issues:Issue[];availability:{runs:boolean;issues:boolean;commit:boolean}}
type Agent = {id:string;role:string;title:string;parent:string|null;children:string[];task:string}
const agents: Agent[]=[
 {id:'pm',role:'PROJECT MANAGER',title:'项目总指挥',parent:null,children:['arch','backend','ui','qa'],task:'跨领域计划、依赖与验收'},
 {id:'arch',role:'ARCHITECTURE',title:'架构智能体',parent:'pm',children:['database','ipc'],task:'Worker / React / D1 系统边界'},
 {id:'backend',role:'BACKEND',title:'后端智能体',parent:'pm',children:['risk','market'],task:'API、行情及安全逻辑'},
 {id:'ui',role:'UI / UX',title:'界面智能体',parent:'pm',children:['frontend','mobile'],task:'终端设计和响应式交互'},
 {id:'qa',role:'QUALITY',title:'测试智能体',parent:'pm',children:['tests','release'],task:'单测、构建与发布验收'},
 {id:'database',role:'DATABASE',title:'D1 账本',parent:'arch',children:[],task:'迁移、原子结算与备份'},
 {id:'ipc',role:'INTEGRATION',title:'跨模块契约',parent:'arch',children:[],task:'事件、API 结构与版本管理'},
 {id:'risk',role:'RISK GUARD',title:'硬风控执行',parent:'backend',children:[],task:'日亏熔断和服务端下单校验'},
 {id:'market',role:'MARKET DATA',title:'真实行情流',parent:'backend',children:[],task:'CVD、盘口及 WebSocket'},
 {id:'frontend',role:'REACT',title:'页面组件',parent:'ui',children:[],task:'研究台与多智能体面板'},
 {id:'mobile',role:'MOBILE',title:'移动端适配',parent:'ui',children:[],task:'iPhone 交互和横屏'},
 {id:'tests',role:'TEST SUITE',title:'自动化测试',parent:'qa',children:[],task:'风险边界与迁移测试'},
 {id:'release',role:'DEPLOY',title:'发布控制',parent:'qa',children:[],task:'GitHub Actions → Cloudflare'},
]
const dependencies=[
 {from:'database',to:'risk',label:'账本迁移 → 硬风控',kind:'阻塞'},
 {from:'market',to:'frontend',label:'实时数据 → 页面',kind:'校验'},
 {from:'risk',to:'tests',label:'下单规则 → 测试',kind:'校验'},
 {from:'tests',to:'release',label:'测试 → 发布',kind:'门禁'},
 {from:'ipc',to:'frontend',label:'接口契约 → 交互',kind:'依赖'},
]
const groups=['arch','backend','ui','qa']
const date=(value:string)=>{try{return new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return '—'}}
const status=(x:Workflow)=>x.status!=='completed'?'运行中':x.conclusion==='success'?'成功':x.conclusion==='failure'?'失败':x.conclusion==='cancelled'?'取消':'未知'
export function AgentOpsPage(){
 const [data,setData]=useState<Ops|null>(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const [selected,setSelected]=useState('pm')
 const [activeTab,setActiveTab]=useState<'tasks'|'runs'>('tasks')
 const [selectedIssue,setSelectedIssue]=useState<number|null>(null)
 const agent=agents.find(x=>x.id===selected)??agents[0]
 const refresh=async()=>{
  try{
   const response=await fetch('/api/agent-ops/status',{cache:'no-store'})
   const body=await response.json() as Ops & {error?:string}
   if(!response.ok||!Array.isArray(body.runs)||!Array.isArray(body.issues))throw Error(body.error||'GitHub 状态暂时不可用')
   setData(body);setError('')
  }catch(e){setError(e instanceof Error?e.message:'状态接口异常')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),30000);return()=>window.clearInterval(timer)},[])
 const openIssues=useMemo(()=>data?.issues.filter(x=>x.state==='open')??[],[data])
 const recent=data?.runs??[]
 const lastDeploy=recent.find(x=>x.name.toLowerCase().includes('deploy'))
 const issue=selectedIssue!==null?data?.issues.find(x=>x.number===selectedIssue):null
 const coverage=agents.map(a=>({id:a.id,label:a.role}))
 return <main className="ao-shell">
  <div className="ao-top">
   <div><div className="ao-overline">YIMING AI QUANT / ENGINEERING INTELLIGENCE</div><h1>AI PROJECT COMMAND <span>项目指挥中心</span></h1><p>多层级智能体职责树 · GitHub 真实任务与部署遥测 · 依赖阻塞跟踪</p></div>
   <div className="ao-top-actions"><span>READ-ONLY · EXECUTION DISABLED</span><button disabled={loading} onClick={()=>void refresh()}>{loading?'读取中':'刷新状态'}</button></div>
  </div>
  <div className="ao-stats">
   <div><span>任务节点</span><strong>{coverage.length}</strong><small>预定义职责，不表示运行实例</small></div>
   <div><span>GitHub 待办</span><strong>{data?.availability.issues?openIssues.length:'—'}</strong><small>公开 Issue 实际状态</small></div>
   <div><span>最近发布</span><strong className={lastDeploy?.conclusion==='success'?'positive':lastDeploy?.conclusion==='failure'?'negative':''}>{lastDeploy?status(lastDeploy):'—'}</strong><small>{lastDeploy?.updated_at?date(lastDeploy.updated_at):'未获取'}</small></div>
   <div><span>实际运行智能体</span><strong>0</strong><small>尚未连接 Agent 执行后端</small></div>
  </div>
  {error&&<p className="ao-error">接口状态：{error}。以下角色树仍可查看，但实时数据未验证。</p>}
  <div className="ao-layout">
   <div className="ao-primary">
    <section className="ao-panel"><div className="ao-panel-title"><div><small>01 / ORGANIZATION</small><h2>多智能体分层架构</h2></div><span>点击节点查看职责</span></div>
     <div className="ao-tree"><div className="ao-root"><button className={selected==='pm'?'chosen':''} onClick={()=>setSelected('pm')}><small>PROJECT MANAGER AGENT</small><b>全局项目经理</b><span>协调规划 / 依赖追踪 / 审计</span></button></div>
      <div className="ao-branches">{groups.map(parent=>{const a=agents.find(x=>x.id===parent)!;return <div className="ao-branch" key={parent}><button className={'ao-role '+(selected===parent?'chosen':'')} onClick={()=>setSelected(parent)}><small>{a.role}</small><b>{a.title}</b><span>{a.task}</span></button><div className="ao-leaves">{a.children.map(child=>{const n=agents.find(x=>x.id===child)!;return <button key={child} className={selected===child?'chosen':''} onClick={()=>setSelected(child)}><small>{n.role}</small><b>{n.title}</b></button>})}</div></div>})}</div>
     </div>
     <p className="ao-note">这些节点代表拟定的 Agent 职责和研发分工，并非已经启动的 AI 进程。真实执行须另接可信任务队列、模型提供商与受限代码执行环境。</p>
    </section>
    <section className="ao-panel"><div className="ao-panel-title"><div><small>02 / DEPENDENCIES & FLOW</small><h2>依赖链路与发布门禁</h2></div><span>静态依赖设计</span></div>
     <div className="ao-flow">{dependencies.map((d,i)=><div className="ao-dep" key={i}><span className="ao-dot"/><div><b>{d.label}</b><small>{d.kind} · {agents.find(x=>x.id===d.from)?.title} → {agents.find(x=>x.id===d.to)?.title}</small></div></div>)}</div>
     <div className="ao-gates">{['DEPENDENCIES','BUILD','RISK TEST','DB MIGRATION','DEPLOY'].map((x,i)=><div key={x}><small>0{i+1}</small><b>{x}</b><span>{i===4?(lastDeploy?status(lastDeploy):'待核验'):i===0?'依赖检查':'依靠 Actions 日志'}</span></div>)}</div>
    </section>
   </div>
   <aside className="ao-sidebar">
    <section className="ao-panel"><div className="ao-panel-title"><div><small>03 / AGENT INSPECTOR</small><h2>{agent.title}</h2></div><span>职责定义</span></div>
      <div className="ao-inspect"><div><span>ROLE</span><b>{agent.role}</b></div><div><span>MISSION</span><b>{agent.task}</b></div><div><span>LIVE EXECUTION</span><b className="ao-muted">未连接运行时</b></div><div><span>REPORTS TO</span><b>{agent.parent?agents.find(x=>x.id===agent.parent)?.title:'项目总指挥'}</b></div></div>
    </section>
    <section className="ao-panel"><div className="ao-panel-title"><div><small>04 / TASKS & TELEMETRY</small><h2>真实工作流监控</h2></div><span>{data?.updatedAt?date(data.updatedAt):'未同步'}</span></div>
      <div className="ao-tabs"><button className={activeTab==='tasks'?'active':''} onClick={()=>setActiveTab('tasks')}>GitHub 任务</button><button className={activeTab==='runs'?'active':''} onClick={()=>setActiveTab('runs')}>构建日志</button></div>
      <div className="ao-activity">{activeTab==='tasks'?data?.issues.slice(0,18).map(x=><button className="ao-activity-row" key={x.number} onClick={()=>setSelectedIssue(x.number)}><b>#{x.number} · {x.title}</b><small>{x.state==='open'?'未关闭':'已关闭'} · {date(x.updated_at)}</small></button>):recent.slice(0,12).map(x=><a className="ao-activity-row" key={x.id} href={x.html_url} target="_blank" rel="noopener noreferrer"><b>{x.name}</b><small>{status(x)} · {date(x.updated_at)} · {x.head_sha?.slice(0,8)}</small></a>)}
      {!data&&<p className="ao-note">正在读取 GitHub 公开状态；不生成模拟日志或假进度条。</p>}</div>
      {issue&&<div className="ao-issue"><small>当前选择的 GitHub Issue</small><b>#{issue.number} {issue.title}</b><a href={issue.html_url} target="_blank" rel="noopener noreferrer">查看真实任务详情</a></div>}
    </section>
    <section className="ao-panel ao-console"><div className="ao-panel-title"><div><small>05 / COMMAND CONSOLE</small><h2>项目经理事件流</h2></div><span>只读</span></div>
     <div><p><em>[INFO]</em> 当前为任务监控台；尚未启动独立 AI 智能体。</p><p><em>[SYNC]</em> {data?.source??'等待 GitHub'} </p><p><em>[HEAD]</em> {data?.commit.sha?.slice(0,10)??'—'} {data?.commit.message?.slice(0,74)??''}</p><p><em>[GUARD]</em> 未授权自动修改代码、D1 数据或资金交易。</p></div>
    </section>
   </aside>
  </div>
 </main>
}
