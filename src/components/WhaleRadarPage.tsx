import { useEffect, useMemo, useRef, useState } from 'react'
import { openPublicTradeSocket, type ActiveSource } from '../lib/market'
import type { SymbolId } from '../types'
import type { TradePrint } from '../lib/orderflow'

const symbols: SymbolId[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
type RadarItem = TradePrint & { notional: number; symbol: SymbolId }
const fmt = (n: number, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n)

export function WhaleRadarPage() {
  const [symbol, setSymbol] = useState<SymbolId>('BTCUSDT')
  const [source, setSource] = useState<ActiveSource>('binance')
  const [minimum, setMinimum] = useState(100000)
  const [events, setEvents] = useState<RadarItem[]>([])
  const [connection, setConnection] = useState<'connecting'|'connected'|'stale'>('connecting')
  const [lastSeen, setLastSeen] = useState<number | null>(null)
  const lastSeenRef = useRef<number | null>(null)
  const [bark, setBark] = useState('正在检查 Bark 服务端配置…')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/bark/status', { cache:'no-store', signal:controller.signal })
      .then(async r => { if (!r.ok) throw Error('status unavailable'); return r.json() as Promise<{configured:boolean;notificationEnabled:boolean}> })
      .then(x => setBark(x.configured ? 'Bark 服务端已配置；自动推送规则尚未启用。' : 'Bark 未配置：需在 Cloudflare Worker Secrets 设置 BARK_DEVICE_KEY，网页不保存密钥。'))
      .catch(() => { if (!controller.signal.aborted) setBark('Bark 状态暂不可用。') })
    return () => controller.abort()
  }, [])

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
      <label>单笔成交金额门槛<select value={minimum} onChange={e=>setMinimum(Number(e.target.value))}><option value={10000}>≥ 1 万 USDT</option><option value={50000}>≥ 5 万 USDT</option><option value={100000}>≥ 10 万 USDT</option><option value={500000}>≥ 50 万 USDT</option><option value={1000000}>≥ 100 万 USDT</option></select></label>
    </div>
    <div className="whale-metrics">
      <div><span>最近捕获笔数（最多100）</span><b>{stats.count}</b></div>
      <div><span>主动买入累计成交额</span><b className="positive">{fmt(stats.buy)} USDT</b></div>
      <div><span>主动卖出累计成交额</span><b className="negative">{fmt(stats.sell)} USDT</b></div>
    </div>
    <section className="whale-table">
      <div className="whale-table-head"><span>本次页面会话的大额成交流</span><small>{lastSeen ? `最后收到交易：${new Date(lastSeen).toLocaleTimeString('zh-CN')}`:'尚未收到有效逐笔交易'}</small></div>
      {events.length === 0 ? <p className="whale-empty">暂无符合门槛的真实成交。行情断流、区域限制或门槛过高时不会生成模拟数据。</p>:
      <div className="whale-list">{events.map(x=><div className="whale-event" key={`${x.source}:${x.symbol}:${x.id}`}><span>{new Date(x.timestamp).toLocaleTimeString('zh-CN')}</span><b>{x.symbol.replace('USDT','/USDT')}</b><span className={x.aggressor==='buy'?'positive':'negative'}>{x.aggressor==='buy'?'主动买入':'主动卖出'}</span><span>{fmt(x.price)}</span><strong>{fmt(x.notional)} U</strong><small>{x.source}</small></div>)}</div>}
    </section>
    <div className="whale-bark"><b>Bark 推送状态</b><p>{bark}</p><small>本页不请求或显示 Bark 设备密钥；自动推送需后端规则、鉴权和去重验收后才启用。</small></div>
  </main>
}
