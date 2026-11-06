import { useEffect, useMemo, useRef, useState } from 'react'
import { openPublicTradeSocket, type ActiveSource } from '../lib/market'
import type { SymbolId } from '../types'
import type { TradePrint } from '../lib/orderflow'
import { openBinanceLiquidationSocket, type LiquidationPrint } from '../lib/liquidations'
import { WhaleAnalytics } from './WhaleAnalytics'
import { WhaleDeepMonitor } from './WhaleDeepMonitor'

const symbols: SymbolId[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
type RadarItem = TradePrint & { notional: number; symbol: SymbolId }
const fmt = (n: number, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n)

export function WhaleRadarPage() {
  const [symbol, setSymbol] = useState<SymbolId>('BTCUSDT')
  const [source, setSource] = useState<ActiveSource>('okx')
  const [minimum, setMinimum] = useState(0)
  const [events, setEvents] = useState<RadarItem[]>([])
  const [connection, setConnection] = useState<'connecting'|'connected'|'stale'>('connecting')
  const [lastSeen, setLastSeen] = useState<number | null>(null)
  const lastSeenRef = useRef<number | null>(null)
  const [snapshot,setSnapshot]=useState<RadarItem[]>([])
  const [snapshotSource,setSnapshotSource]=useState('')
  const [snapshotError,setSnapshotError]=useState('')
  const [snapshotTime,setSnapshotTime]=useState<number|null>(null)
  const [bark, setBark] = useState('正在检查 Bark 服务端配置…')
  const [liquidations, setLiquidations] = useState<LiquidationPrint[]>([])
  const [liquidationState, setLiquidationState] = useState('连接中')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/bark/status', { cache:'no-store', signal:controller.signal })
      .then(async r => { if (!r.ok) throw Error('status unavailable'); return r.json() as Promise<{configured:boolean;notificationEnabled:boolean}> })
      .then(x => setBark(x.configured ? 'Bark 服务端已配置；自动推送规则尚未启用。' : 'Bark 未配置：需在 Cloudflare Worker Secrets 设置 BARK_DEVICE_KEY，网页不保存密钥。'))
      .catch(() => { if (!controller.signal.aborted) setBark('Bark 状态暂不可用。') })
    return () => controller.abort()
  }, [])

  // Exchange REST snapshot avoids an empty radar when mobile WebSocket is unavailable.
  // The sample is only the most recent exchange-returned trades; never claim full-market coverage.
  useEffect(()=>{
    const controller=new AbortController()
    let active=true
    setSnapshot([])
    setSnapshotError('正在读取交易所近期真实成交…')
    const refresh=async()=>{
      try{
        const response=await fetch(`/api/whale/trades?symbol=${symbol}&source=auto`, {cache:'no-store',signal:controller.signal})
        const data=await response.json() as {trades?:RadarItem[];source?:string;fetchedAt?:number;error?:string;errors?:Record<string,string>}
        if(!response.ok || !Array.isArray(data.trades))throw new Error(data.error||'近期成交接口不可用')
        if(!active)return
        setSnapshot(data.trades)
        setSnapshotSource(data.source||'')
        setSnapshotTime(data.fetchedAt||Date.now())
        setSnapshotError('')
      }catch(e){
        if(!active)return
        setSnapshotError(e instanceof Error?e.message:'近期成交加载失败')
      }
    }
    void refresh()
    const timer=window.setInterval(()=>void refresh(),20000)
    return()=>{active=false;window.clearInterval(timer);controller.abort()}
  },[symbol])
  const filteredSnapshot=useMemo(()=>snapshot.filter(x=>x.notional>=minimum),[snapshot,minimum])
  const recentTotals=useMemo(()=>{
    const buy=snapshot.filter(x=>x.aggressor==='buy').reduce((sum,x)=>sum+x.notional,0)
    const sell=snapshot.filter(x=>x.aggressor==='sell').reduce((sum,x)=>sum+x.notional,0)
    return {buy,sell}
  },[snapshot])

  useEffect(() => {
    let running = true
    let socket: WebSocket | null = null
    let reconnect: ReturnType<typeof setTimeout> | null = null
    const seen = new Set<string>()
    setConnection('connecting')
    setEvents([])
    setLastSeen(null)
    lastSeenRef.current = null
    const connect = () => {
      if (!running) return
      try {
        socket = openPublicTradeSocket(symbol, source, trade => {
          if (!running) return
          setConnection('connected')
          lastSeenRef.current = Date.now()
          setLastSeen(lastSeenRef.current)
          const id = `${source}:${trade.id}`
          if (seen.has(id)) return
          seen.add(id)
          if (seen.size > 3000) seen.clear()
          const notional = trade.price * trade.qty
          if (!Number.isFinite(notional) || notional < minimum) return
          setEvents(prev => [{ ...trade, symbol, notional }, ...prev].slice(0, 100))
        }, () => setConnection('stale'))
        socket.addEventListener('open', () => setConnection('connected'))
        socket.addEventListener('close', () => {
          if (!running) return
          setConnection('stale')
          reconnect = window.setTimeout(connect, 5000)
        })
      } catch { setConnection('stale') }
    }
    connect()
    const monitor = window.setInterval(() => {
      if (lastSeenRef.current !== null && Date.now()-lastSeenRef.current > 60000) setConnection('stale')
    }, 10000)
    return () => { running = false; if (reconnect) clearTimeout(reconnect); clearInterval(monitor); socket?.close() }
  }, [symbol,source,minimum])

  useEffect(() => {
    let active=true, ws:WebSocket|null=null
    let retry:ReturnType<typeof setTimeout>|null=null
    const ids=new Set<string>()
    setLiquidations([]);setLiquidationState('连接中')
    const connect=()=>{
      if(!active)return
      try {
        ws=openBinanceLiquidationSocket(symbol,item=>{
          if(!active || ids.has(item.id))return
          ids.add(item.id)
          if(ids.size>1000)ids.clear()
          setLiquidations(prev=>[item,...prev].slice(0,100))
          setLiquidationState('已接收真实强平广播')
        })
        ws.addEventListener('open',()=>setLiquidationState('已连接 · 等待强平广播'))
        ws.addEventListener('error',()=>setLiquidationState('数据暂不可用'))
        ws.addEventListener('close',()=>{
          if(!active)return
          setLiquidationState('断流重连中')
          retry=window.setTimeout(connect,5000)
        })
      }catch { setLiquidationState('数据暂不可用') }
    }
    connect()
    return ()=>{active=false;if(retry)clearTimeout(retry);ws?.close()}
  },[symbol])
  const liquidationSummary=useMemo(()=>{
    const buy=liquidations.filter(x=>x.side==='BUY').reduce((sum,x)=>sum+x.notional,0)
    const sell=liquidations.filter(x=>x.side==='SELL').reduce((sum,x)=>sum+x.notional,0)
    return {buy,sell}
  },[liquidations])

  const stats = useMemo(() => {
    const buy = events.filter(x=>x.aggressor === 'buy').reduce((v,x)=>v+x.notional,0)
    const sell = events.filter(x=>x.aggressor === 'sell').reduce((v,x)=>v+x.notional,0)
    return {buy,sell,count:events.length}
  },[events])
  return <main className="whale-page">
    <div className="whale-heading">
      <div><div className="eyebrow">WHALE RADAR · PUBLIC SPOT TRADES</div><h1>鲸鱼雷达 · 大额主动成交</h1><p>交易所公开现货逐笔成交，按单笔成交额筛选；“鲸鱼”仅为金额标签，不能据此认定交易者是机构或巨鲸。</p></div>
      <span className={`whale-status ${connection}`}>{connection==='connected'?'● 实时订阅':connection==='connecting'?'○ 正在连接':'● 断流重连中'}</span>
    </div>
    <div className="whale-controls">
      <label>币种<select value={symbol} onChange={e=>setSymbol(e.target.value as SymbolId)}>{symbols.map(x=><option key={x} value={x}>{x.replace('USDT','/USDT')}</option>)}</select></label>
      <label>交易所<select value={source} onChange={e=>setSource(e.target.value as ActiveSource)}><option value="binance">Binance 现货</option><option value="okx">OKX 现货</option></select></label>
      <label>单笔成交金额门槛<select value={minimum} onChange={e=>setMinimum(Number(e.target.value))}><option value={0}>全部近期成交</option><option value={1000}>≥ 1 千 USDT</option><option value={10000}>≥ 1 万 USDT</option><option value={50000}>≥ 5 万 USDT</option><option value={100000}>≥ 10 万 USDT</option><option value={500000}>≥ 50 万 USDT</option><option value={1000000}>≥ 100 万 USDT</option></select></label>
    </div>
    <div className="whale-metrics">
      <div><span>最近捕获笔数（最多100）</span><b>{stats.count}</b></div>
      <div><span>主动买入累计成交额</span><b className="positive">{fmt(stats.buy)} USDT</b></div>
      <div><span>主动卖出累计成交额</span><b className="negative">{fmt(stats.sell)} USDT</b></div>
    </div>
    <WhaleAnalytics trades={snapshot} source={snapshotSource} fetchedAt={snapshotTime}/>
    <WhaleDeepMonitor symbol={symbol}/>
    <section className="whale-table whale-snapshot">
      <div className="whale-table-head"><span>交易所最近真实成交（REST 自动补载）</span><small>{snapshotSource ? `${snapshotSource} · ${snapshotTime ? new Date(snapshotTime).toLocaleTimeString('zh-CN') : ''}` : '正在检查可用数据源'}</small></div>
      <div className="whale-metrics whale-liquidation-metrics">
        <div><span>接口返回有效成交样本</span><b>{snapshot.length}</b></div>
        <div><span>样本主动买入额</span><b className="positive">{fmt(recentTotals.buy)} U</b></div>
        <div><span>样本主动卖出额</span><b className="negative">{fmt(recentTotals.sell)} U</b></div>
      </div>
      {snapshotError && <p className="whale-empty">状态：{snapshotError}</p>}
      {snapshot.length>0 && filteredSnapshot.length===0 && <p className="whale-empty">已收到 {snapshot.length} 笔真实成交，但没有达到当前金额门槛。将门槛切换为“全部近期成交”即可查看。</p>}
      {filteredSnapshot.length>0 && <div className="whale-list">{filteredSnapshot.slice(0,100).map(x=><div className="whale-event" key={`snapshot:${x.source}:${x.id}`}><span>{new Date(x.timestamp).toLocaleTimeString('zh-CN')}</span><b>{symbol.replace('USDT','/USDT')}</b><span className={x.aggressor==='buy'?'positive':'negative'}>{x.aggressor==='buy'?'主动买入':'主动卖出'}</span><span>{fmt(x.price)}</span><strong>{fmt(x.notional)} U</strong><small>{x.source}</small></div>)}</div>}
      <p className="whale-feed-note">这是交易所返回的近期成交样本，不是过去24小时全部交易。每20秒刷新一次；若上游接口受地域限制，会显示具体失败状态。</p>
    </section>
    <section className="whale-table">
      <div className="whale-table-head"><span>本次页面会话的大额成交流</span><small>{lastSeen ? `最后收到交易：${new Date(lastSeen).toLocaleTimeString('zh-CN')}`:'尚未收到有效逐笔交易'}</small></div>
      {events.length === 0 ? <p className="whale-empty">暂无符合门槛的真实成交。行情断流、区域限制或门槛过高时不会生成模拟数据。</p>:
      <div className="whale-list">{events.map(x=><div className="whale-event" key={`${x.source}:${x.symbol}:${x.id}`}><span>{new Date(x.timestamp).toLocaleTimeString('zh-CN')}</span><b>{x.symbol.replace('USDT','/USDT')}</b><span className={x.aggressor==='buy'?'positive':'negative'}>{x.aggressor==='buy'?'主动买入':'主动卖出'}</span><span>{fmt(x.price)}</span><strong>{fmt(x.notional)} U</strong><small>{x.source}</small></div>)}</div>}
    </section>
    <section className="whale-table">
      <div className="whale-table-head"><span>真实强平广播 · Binance USD-M</span><small>{liquidationState}</small></div>
      <div className="whale-metrics whale-liquidation-metrics">
        <div><span>BUY 方向强平订单广播成交额</span><b className="positive">{fmt(liquidationSummary.buy)} USDT</b></div>
        <div><span>SELL 方向强平订单广播成交额</span><b className="negative">{fmt(liquidationSummary.sell)} USDT</b></div>
        <div><span>本次会话已捕获广播</span><b>{liquidations.length}</b></div>
      </div>
      {liquidations.length ? <div className="whale-list">
        {liquidations.map(x=><div className="whale-event" key={x.id}>
          <span>{new Date(x.time).toLocaleTimeString('zh-CN')}</span>
          <b>{x.symbol.replace('USDT','/USDT')}</b>
          <span className={x.side==='BUY'?'positive':'negative'}>{x.side==='BUY'?'BUY':'SELL'}</span>
          <span>{fmt(x.price)}</span><strong>{fmt(x.notional)} U</strong><small>公开强平</small>
        </div>)}
      </div> : <p className="whale-empty">尚无强平广播。此数据源可能受区域网络限制；未收到事件不代表市场没有强平。</p>}
      <p className="whale-feed-note">仅展示交易所公开强平订单快照，可能有广播频率限制和遗漏。不能据此复原全部清算量、预测未发生的爆仓价，也不能识别鲸鱼持仓账户；完整清算热力图需要额外可核实的持仓/杠杆分布数据。</p>
    </section>
    <section className="whale-bark"><b>资金流向及持仓口径说明</b><p>上方主动买卖成交额是当前页面捕获的大额现货成交差，不代表交易所真实净入金，也不能识别某个账户持仓。公开大户多空账户比和资金费率可在“杠杆风控”查看；个人鲸鱼持仓尚无可靠公开数据源。</p></section>
    <div className="whale-bark"><b>Bark 推送状态</b><p>{bark}</p><small>本页不请求或显示 Bark 设备密钥；自动推送需后端规则、鉴权和去重验收后才启用。</small></div>
  </main>
}
