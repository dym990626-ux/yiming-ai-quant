import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PriceChart } from './components/PriceChart'
import { BacktestPage } from './components/BacktestPage'
import { SimTradePage } from './components/SimTradePage'
import { ResearchPage } from './components/ResearchPage'
import { SettingsPage, readSettings, settingsKey, type AppSettings } from './components/SettingsPage'
import { AlertPanel } from './components/AlertPanel'
import { LeverageRiskPage } from './components/LeverageRiskPage'
import { fetchKlines, fetchTicker, intervals, openBinanceKlineSocket, openOkxKlineSocket, openOkxTickerSocket, openTickerSocket, sourceOf, symbols, type ActiveSource } from './lib/market'
import { macd, rsi } from './lib/indicators'
import type { Candle, ConnectionState, IntervalId, SymbolId, Ticker } from './types'

const formatPrice = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 6 }).format(n)
const formatCompact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
const formatTime = (time?: number) => time ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(time) : '—'

export default function App() {
  const initialSettings = useMemo(readSettings, [])
  const [settings, setSettings] = useState<AppSettings>(initialSettings)
  const [page, setPage] = useState('行情中心'), [symbol, setSymbol] = useState<SymbolId>(initialSettings.defaultSymbol), [interval, setInterval] = useState<IntervalId>(initialSettings.defaultInterval)
  const [candles, setCandles] = useState<Candle[]>([]), [ticker, setTicker] = useState<Ticker | null>(null), [status, setStatus] = useState<ConnectionState>('loading'), [error, setError] = useState<string | null>(null),[activeSource,setActiveSource]=useState<ActiveSource|null>(null)
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null), attempts = useRef(0)
  const load = useCallback(async (signal?: AbortSignal) => { setError(null); setCandles([]); setTicker(null); setActiveSource(null); setStatus('loading'); try { const [nextCandles, nextTicker] = await Promise.all([fetchKlines(symbol, interval, signal, settings.source), fetchTicker(symbol, signal, settings.source)]); setCandles(nextCandles); setTicker(nextTicker); setActiveSource(sourceOf(nextTicker)); setStatus('reconnecting') } catch (e) { if (!signal?.aborted) { setError(e instanceof Error ? e.message : '无法加载公开行情'); setStatus('error') } } }, [symbol, interval, settings.source])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  useEffect(() => {
    if(!activeSource)return
    let tickerWs:WebSocket|null=null,klineWs:WebSocket|null=null,active=true,last=Date.now(),heartbeat:ReturnType<typeof window.setInterval>|null=null
    const touch=()=>{last=Date.now();attempts.current=0;setStatus('connected')}
    const onCandle=(update:{candle:Candle})=>{touch();setCandles(prev=>{const list=[...prev],i=list.findIndex(x=>x.time===update.candle.time);if(i>=0)list[i]=update.candle;else list.push(update.candle);return list.sort((a,b)=>a.time-b.time).slice(-1000)})}
    const retry=()=>{if(!active||reconnect.current)return;setStatus('stale');const wait=Math.min(30_000,1000*2**attempts.current++);reconnect.current=window.setTimeout(()=>{reconnect.current=null;connect()},wait)}
    const connect=()=>{if(!active)return
      tickerWs=activeSource==='okx'?openOkxTickerSocket(symbol,t=>{touch();setTicker(t)},touch,retry,()=>setStatus('stale')):openTickerSocket(symbol,t=>{touch();setTicker(t)},touch,retry,()=>setStatus('stale'))
      klineWs=activeSource==='okx'?openOkxKlineSocket(symbol,interval,onCandle,touch,retry,()=>setStatus('stale')):openBinanceKlineSocket(symbol,interval,onCandle,touch,retry,()=>setStatus('stale'))
      heartbeat=window.setInterval(()=>{if(Date.now()-last>50_000){tickerWs?.close();klineWs?.close();retry()}},3000)
    }
    connect();return()=>{active=false;if(reconnect.current)clearTimeout(reconnect.current);if(heartbeat)clearInterval(heartbeat);tickerWs?.close();klineWs?.close()}
  }, [symbol,interval,activeSource])
  const changeSettings = (next: AppSettings) => { setSettings(next); localStorage.setItem(settingsKey, JSON.stringify(next)) }
  const analysis = useMemo(() => ({ rsi: rsi(candles).at(-1)?.value, macd: macd(candles).macd.at(-1)?.value }), [candles])
  const up = (ticker?.changePercent ?? 0) >= 0
  const nav = ['行情中心', '杠杆风控', '六 AI 研究', '历史回测', '模拟交易', '设置']
  if (page !== '行情中心') return <><header className="topbar"><button className="brand" onClick={() => setPage('行情中心')}><span className="brand-mark">Y</span><span>一鸣 AI Quant</span></button><nav>{nav.map(x => <button className={page === x ? 'active' : ''} onClick={() => setPage(x)} key={x}>{x}</button>)}</nav></header>{page === '杠杆风控' ? <LeverageRiskPage /> : page === '历史回测' ? <BacktestPage /> : page === '模拟交易' ? <SimTradePage symbol={symbol} ticker={ticker} status={status} /> : page === '六 AI 研究' ? <ResearchPage candles={candles} ticker={ticker} symbol={symbol} interval={interval} /> : <SettingsPage settings={settings} onChange={changeSettings} />}</>
  return <div className="app"><header className="topbar"><button className="brand"><span className="brand-mark">Y</span><span>一鸣 AI Quant</span></button><nav>{nav.map(x => <button className={page === x ? 'active' : ''} onClick={() => setPage(x)} key={x}>{x}</button>)}</nav><div className={`connection ${status}`}><i />{status === 'connected' ? '实时连接' : status === 'loading' ? '加载中' : status === 'reconnecting' ? '等待实时流' : status === 'stale' ? '数据已过期 · 重连中' : '连接异常'}</div></header>
  <div className="terminal"><aside className="symbols"><div className="section-label">交易品种 <span>USDT</span></div>{(Object.keys(symbols) as SymbolId[]).map(id => <button key={id} onClick={() => setSymbol(id)} className={`symbol ${symbol === id ? 'selected' : ''}`}><b>{symbols[id].label}</b><small>{symbols[id].name}</small>{id === symbol && ticker && <em className={ticker.changePercent >= 0 ? 'positive' : 'negative'}>{ticker.changePercent >= 0 ? '+' : ''}{ticker.changePercent.toFixed(2)}%</em>}</button>)}<div className="source-note">数据来源<br/><b>{ticker?.source ?? '连接中'}</b><br/>现货 · 公开 REST / WebSocket</div></aside>
  <main className="market"><section className="quote"><div><span className="pair">{symbols[symbol].label}</span><span className="exchange">{ticker?.source ? `${ticker.source} · SPOT` : '数据源连接中'}</span><h1 className={up ? 'positive' : 'negative'}>{ticker ? formatPrice(ticker.price) : '—'} <small>USDT</small></h1><p className={up ? 'positive' : 'negative'}>{ticker ? `${up ? '+' : ''}${ticker.changePercent.toFixed(2)}%` : '等待真实数据'}</p></div><div className="quote-stats"><Stat label="24h 最高" value={ticker ? formatPrice(ticker.high) : '—'} /><Stat label="24h 最低" value={ticker ? formatPrice(ticker.low) : '—'} /><Stat label="24h 成交量" value={ticker ? (settings.compactNumbers ? formatCompact(ticker.volume) : ticker.volume.toFixed(4)) : '—'} /><Stat label="24h 成交额" value={ticker ? `${settings.compactNumbers ? formatCompact(ticker.quoteVolume) : ticker.quoteVolume.toFixed(2)} USDT` : '—'} /></div></section>
  <section className="chart-panel"><div className="periods">{intervals.map(x => <button onClick={() => setInterval(x.id)} className={interval === x.id ? 'active' : ''} key={x.id}>{x.label}</button>)}<span className="chart-legend"><i className="ma7"/>MA7 <i className="ma25"/>MA25 <i className="ma99"/>MA99</span></div>{error ? <div className="data-error"><b>无法获取真实行情</b><p>{error}</p><button onClick={() => void load()}>重新加载</button></div> : candles.length ? <PriceChart candles={candles} chartKey={`${symbol}-${interval}`} /> : <div className="loading">正在请求公开交易所 K 线…</div>}</section>
  <section className="indicator-strip"><Indicator label="RSI (14)" value={analysis.rsi?.toFixed(2) ?? '—'} /><Indicator label="MACD (12, 26, 9)" value={analysis.macd?.toFixed(4) ?? '—'} /><Indicator label="布林带" value="20 / 2" /><Indicator label="成交量" value={candles.at(-1) ? formatCompact(candles.at(-1)!.volume) : '—'} /></section></main>
  <aside className="research"><div className="panel-title">研究面板 <span>规则证据</span></div>{['趋势分析', '资金分析', '波动分析', '风险分析', '策略分析', '综合决策'].map((x, i) => <button className="research-item" onClick={()=>setPage('六 AI 研究')} key={x}><div className="research-icon">0{i + 1}</div><div><b>{x}</b><p>打开研究中心查看可审计数据</p></div><span>›</span></button>)}<div className="research-disclaimer">结论仅在已载入真实行情和规则证据充分时展示。</div><AlertPanel symbol={symbol} ticker={ticker}/></aside></div>
  <footer><span>技术指标：MA / EMA / RSI / MACD / Bollinger / Volume</span><span>行情更新时间：{formatTime(ticker?.updatedAt)}</span><span className={status === 'connected' ? 'positive' : 'negative'}>{status === 'connected' ? '● 数据流正常' : '● 数据非实时'}</span></footer></div>
}
function Stat({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div> }
function Indicator({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div> }
