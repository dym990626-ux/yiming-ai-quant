import { normalizeDepth } from './lib/depth'
import { evaluateSimRisk } from './lib/riskGuard'
type QueryResult<T> = { results: T[] }

type D1Statement = {
  bind(...params: unknown[]): D1Statement
  all<T>(): Promise<QueryResult<T>>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

type D1Database = {
  prepare(query: string): D1Statement
}

type AssetBinding = {
  fetch(request: Request): Promise<Response>
}

type Env = {
  ASSETS: AssetBinding
  DB: D1Database
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  ALERT_API_KEY?: string
  SIM_API_KEY?: string
  BARK_DEVICE_KEY?: string
  BARK_ADMIN_KEY?: string
}

type SchemaRow = { name: string }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const FUTURES_API = 'https://fapi.binance.com'
const OKX_API = 'https://www.okx.com'
const supportedSymbols = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])

const symbolFrom = (value: string | null) => {
  const symbol = (value || 'BTCUSDT').toUpperCase()
  if (!supportedSymbols.has(symbol)) throw new Error(`暂不支持交易对：${symbol}`)
  return symbol
}

async function futures(path: string, params: Record<string, string | number>) {
  const url = new URL(`${FUTURES_API}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; YimingAIQuant/1.0; public-market-research)' } })
  if (!response.ok) throw new Error(`Binance 行情错误 HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

async function okx(path: string, params: Record<string, string | number>) {
  const url = new URL(`${OKX_API}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; YimingAIQuant/1.0; public-market-research)' } })
  if (!response.ok) throw new Error(`OKX 行情错误 HTTP ${response.status}`)
  const payload = await response.json() as { code?: string, msg?: string, data?: unknown[] }
  if (payload.code !== '0' || !Array.isArray(payload.data)) throw new Error(`OKX 行情错误：${payload.msg || payload.code || '响应格式无效'}`)
  return payload.data
}

const value = (input: unknown) => {
  const output = Number(input)
  return Number.isFinite(output) ? output : null
}

function calculateRsi(closes: number[], period = 14) {
  if (closes.length <= period) return null
  let gain = 0, loss = 0
  for (let index = 1; index <= period; index += 1) { const delta = closes[index] - closes[index - 1]; gain += Math.max(delta, 0); loss += Math.max(-delta, 0) }
  let averageGain = gain / period, averageLoss = loss / period
  for (let index = period + 1; index < closes.length; index += 1) { const delta = closes[index] - closes[index - 1]; averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period }
  return averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
}

function calculateMacd(closes: number[]) {
  const ema = (period: number) => closes.reduce<number[]>((list, current, index) => [...list, index ? current * 2 / (period + 1) + list[index - 1] * (1 - 2 / (period + 1)) : current], [])
  if (closes.length < 35) return { macd: null, signal: null, histogram: null, state: '数据不足' }
  const fast = ema(12), slow = ema(26), line = closes.map((_, index) => fast[index] - slow[index])
  const signal = line.reduce<number[]>((list, current, index) => [...list, index ? current * .2 + list[index - 1] * .8 : current], [])
  const macd = line.at(-1)!, signalValue = signal.at(-1)!, histogram = macd - signalValue
  return { macd, signal: signalValue, histogram, state: macd > signalValue && histogram > 0 ? '多头动能' : macd < signalValue && histogram < 0 ? '空头动能' : '动能走平' }
}

async function binanceMarketFor(symbol: string) {
  const [premium, ratioRows, rawKlines] = await Promise.all([
    futures('/fapi/v1/premiumIndex', { symbol }) as Promise<{ markPrice: string, indexPrice: string, lastFundingRate: string, nextFundingTime: number, time: number }>,
    futures('/futures/data/topLongShortAccountRatio', { symbol, period: '1h', limit: 1 }) as Promise<Array<{ longShortRatio: string, longAccount: string, shortAccount: string, timestamp: number }>>,
    futures('/fapi/v1/klines', { symbol, interval: '1h', limit: 120 }) as Promise<Array<[number, string, string, string, string, string, number]>>,
  ])
  const closes = rawKlines.map(row => Number(row[4])).filter(Number.isFinite)
  const ratio = ratioRows.at(-1)
  const fundingRate = value(premium.lastFundingRate)
  const markPrice = value(premium.markPrice)
  if (markPrice === null || markPrice <= 0 || !Number.isFinite(premium.time) || Date.now() - premium.time > 60000 || premium.time > Date.now() + 10000) throw new Error('Binance 标记价格缺失或过期')
  return {
    symbol, markPrice, markPriceTimestamp: premium.time, indexPrice: value(premium.indexPrice), fundingRate,
    fundingRatePercent: fundingRate === null ? null : fundingRate * 100, nextFundingTime: premium.nextFundingTime,
    topLongShortAccountRatio: value(ratio?.longShortRatio), topLongAccount: value(ratio?.longAccount), topShortAccount: value(ratio?.shortAccount),
    rsi14: calculateRsi(closes), macd: calculateMacd(closes), updatedAt: Date.now(), source: 'Binance USDⓈ-M Futures Public API',
  }
}

async function okxMarketFor(symbol: string) {
  const base = symbol.replace('USDT', '')
  const instId = `${base}-USDT-SWAP`
  const [fundingRows, candleRows, markRows] = await Promise.all([
    okx('/api/v5/public/funding-rate', { instId }) as Promise<Array<{ fundingRate: string, nextFundingTime: string }>>,
    okx('/api/v5/market/candles', { instId, bar: '1H', limit: 120 }) as Promise<Array<[string, string, string, string, string, string, string, string, string]>>,
    okx('/api/v5/public/mark-price', { instType: 'SWAP', instId }) as Promise<Array<{ markPx: string, ts: string }>>,
  ])
  const funding = fundingRows[0]
  const closes = candleRows.slice().reverse().map(row => Number(row[4])).filter(Number.isFinite)
  if (!funding || !closes.length) throw new Error('OKX 返回的合约行情不完整')
  const fundingRate = value(funding.fundingRate)
  const markRow = markRows[0]
  const markPrice = value(markRow?.markPx)
  const markTimestamp = Number(markRow?.ts)
  if (markPrice === null || markPrice <= 0 || !Number.isFinite(markTimestamp) || Date.now() - markTimestamp > 60000 || markTimestamp > Date.now() + 10000) throw new Error('OKX 标记价格缺失或过期：拒绝使用成交价或收盘价替代')
  return {
    symbol, markPrice, markPriceTimestamp: markTimestamp, indexPrice: null, fundingRate,
    fundingRatePercent: fundingRate === null ? null : fundingRate * 100, nextFundingTime: Number(funding.nextFundingTime) || null,
    topLongShortAccountRatio: null, topLongAccount: null, topShortAccount: null,
    rsi14: calculateRsi(closes), macd: calculateMacd(closes), updatedAt: Date.now(),
    source: 'OKX SWAP Mark Price + 公共行情（指数价格及大户账户比未提供同口径数据）',
  }
}

async function marketFor(symbol: string) {
  try {
    return await binanceMarketFor(symbol)
  } catch (binanceError) {
    try {
      return await okxMarketFor(symbol)
    } catch (okxError) {
      const binanceMessage = binanceError instanceof Error ? binanceError.message : '未知错误'
      const okxMessage = okxError instanceof Error ? okxError.message : '未知错误'
      throw new Error(`Binance 不可用（${binanceMessage}）；OKX 备用源不可用（${okxMessage}）`)
    }
  }
}

function scoreFor(market: Awaited<ReturnType<typeof marketFor>>) {
  const funding = market.fundingRate || 0, ratio = market.topLongShortAccountRatio || 1, rsi = market.rsi14 || 50
  const clamp = (number: number, min: number, max: number) => Math.min(max, Math.max(min, number))
  const score = Math.round(clamp(50 - funding * 40000 + (ratio - 1) * 18 + (rsi - 50) * .22, 0, 100))
  const state = score > 70 ? '多头过热预警' : score < 30 ? '空头极度恐慌' : score >= 55 ? '温和偏多' : score <= 45 ? '温和偏空' : '中性观察'
  const warning = score > 70 ? '谨防向下扎针清算；高分不等同于追涨信号。' : score < 30 ? '谨防向上扎针清算；低分不等同于做空信号。' : '信号未达极端，仍需执行止损与仓位纪律。'
  return { value: score, state, warning, components: { fundingRate: market.fundingRatePercent, topLongShortAccountRatio: ratio, rsi14: rsi } }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // The Bark device key is a Worker secret and is never included in responses or HTML.
    if (url.pathname === '/api/bark/status') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      return json({ configured: Boolean(env.BARK_DEVICE_KEY), notificationEnabled: false, mode: 'manual-authenticated-test-only' })
    }

    // Authenticated infrastructure smoke test. Not callable from the public UI.
    if (url.pathname === '/api/bark/test') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      if (!env.BARK_DEVICE_KEY || !env.BARK_ADMIN_KEY) return json({ error: 'Bark 安全密钥未配置' }, 503)
      if (request.headers.get('X-Bark-Admin-Key') !== env.BARK_ADMIN_KEY) return json({ error: 'Unauthorized' }, 401)
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 7000)
        let response: Response
        try {
          response = await fetch('https://api.day.app/push', {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              device_key: env.BARK_DEVICE_KEY,
              title: '一鸣 AI Quant · Bark 测试',
              body: '服务端推送通道测试，非交易信号。',
              group: 'Yiming AI Quant',
            }),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeout)
        }
        if (!response.ok) return json({ ok: false, error: 'Bark 推送网关拒绝请求', status: response.status }, 502)
        const data = await response.json() as { code?: number; message?: string }
        if (data.code !== 200) return json({ ok: false, error: 'Bark 网关未确认发送', status: data.code ?? null }, 502)
        return json({ ok: true, acceptedByBark: true, deliveredToDevice: 'not_verified' })
      } catch {
        return json({ ok: false, error: 'Bark 推送失败或超时（未发送密钥到客户端）' }, 502)
      }
    }

    // Public depth is a current order-book snapshot, not a future liquidation heatmap.
    if (url.pathname === '/api/whale/depth') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' },405)
      let symbol: string
      try { symbol = symbolFrom(url.searchParams.get('symbol')) }
      catch { return json({ error:'不支持此交易对' },400) }
      const sourcePreference = url.searchParams.get('source') || 'auto'
      if (!['auto','okx','binance'].includes(sourcePreference)) return json({ error: '非法数据源' },400)
      const errors: Record<string,string> = {}
      const sources: Array<'OKX'|'Binance'> = sourcePreference==='okx'?['OKX']:
        sourcePreference==='binance'?['Binance']:['OKX','Binance']
      for (const source of sources) {
        const controller = new AbortController()
        const timeout = setTimeout(()=>controller.abort(),6500)
        try {
          const api = source==='OKX'
            ? `https://www.okx.com/api/v5/market/books?instId=${symbol.replace('USDT','-USDT')}&sz=50`
            : `https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=100`
          const resp=await fetch(api,{signal:controller.signal,headers:{accept:'application/json'}})
          if(!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const data=await resp.json() as unknown
          const rows = source==='OKX'
            ? (data && typeof data==='object' && (data as {code?:string}).code==='0'
                ? (data as {data?:unknown[]}).data?.[0] : null)
            : data
          const snapshot=normalizeDepth(rows,source,symbol)
          // A stale exchange timestamp is not a live order book.
          if(snapshot.exchangeTime !== null &&
             (Date.now()-snapshot.exchangeTime>60_000 || snapshot.exchangeTime>Date.now()+10_000))
            throw new Error('交易所盘口时间戳已过期')
          return json(snapshot)
        } catch(e) { errors[source]=e instanceof Error?e.message:'数据处理失败' }
        finally { clearTimeout(timeout) }
      }
      return json({error:'公开盘口深度暂不可用，未使用假数据',errors,symbol},502)
    }

    // A bounded REST snapshot helps mobile users when exchange WebSockets are blocked.
    // Returns ONLY exchange-confirmed individual spot trades, never synthetic whale events.
    if (url.pathname === '/api/whale/trades') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      let symbol: string
      try { symbol = symbolFrom(url.searchParams.get('symbol')) }
      catch { return json({ error: 'Unsupported symbol' }, 400) }
      const requestedSource = url.searchParams.get('source')
      if (requestedSource && !['auto', 'okx', 'binance'].includes(requestedSource)) return json({ error: 'Invalid source' }, 400)
      const parseTrade = (row: Record<string, unknown>, source: 'OKX' | 'Binance') => {
        const price = Number(source === 'OKX' ? row.px : row.price)
        const qty = Number(source === 'OKX' ? row.sz : row.qty)
        const timestamp = Number(source === 'OKX' ? row.ts : row.time)
        const id = String(source === 'OKX' ? row.tradeId : row.id)
        const aggressor = source === 'OKX' ? row.side : row.isBuyerMaker === true ? 'sell' : 'buy'
        if (!id || id === 'undefined' || !Number.isFinite(price) || price <= 0 ||
            !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(timestamp) || timestamp <= 0 ||
            !['buy', 'sell'].includes(String(aggressor))) return null
        return { id, symbol, source, timestamp, price, qty, notional: price * qty, aggressor }
      }
      const errors: Record<string,string> = {}
      const fetchSource = async (source: 'OKX' | 'Binance') => {
        const address = source === 'OKX'
          ? `https://www.okx.com/api/v5/market/trades?instId=${symbol.replace('USDT','-USDT')}&limit=300`
          : `https://data-api.binance.vision/api/v3/trades?symbol=${symbol}&limit=500`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 6500)
        try {
          const resp = await fetch(address, { signal: controller.signal, headers: { accept: 'application/json' } })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const body = await resp.json() as unknown
          const raw = source === 'OKX'
            ? (body && typeof body === 'object' && (body as {code?:string}).code === '0'
              ? (body as {data?:unknown}).data : null)
            : body
          if (!Array.isArray(raw)) throw new Error('Invalid exchange response')
          const trades = raw.map(x => x && typeof x === 'object' ? parseTrade(x as Record<string,unknown>, source) : null)
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a,b) => b.timestamp - a.timestamp)
          if (!trades.length) throw new Error('No valid trades received')
          return { symbol, source, instrumentType: 'SPOT', fetchedAt: Date.now(), trades, errors }
        } finally { clearTimeout(timeout) }
      }
      const sources: Array<'OKX'|'Binance'> =
        requestedSource === 'binance' ? ['Binance'] :
        requestedSource === 'okx' ? ['OKX'] : ['OKX','Binance']
      for (const source of sources) {
        try { return json(await fetchSource(source)) }
        catch (e) { errors[source] = e instanceof Error ? e.message : 'Unknown market-data failure' }
      }
      return json({ error: '两个公开现货成交接口均不可用；未使用模拟数据', errors, symbol, fetchedAt: Date.now(), trades: [] }, 502)
    }

    if (url.pathname === '/api/market-data') {
      try {
        const requested = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'BTCUSDT').split(',').map(item => symbolFrom(item.trim()))
        const symbols = [...new Set(requested)].slice(0, 3)
        const rows = await Promise.allSettled(symbols.map(marketFor))
        const data: Record<string, unknown> = {}, errors: Record<string, string> = {}
        rows.forEach((row, index) => { if (row.status === 'fulfilled') data[symbols[index]] = row.value; else errors[symbols[index]] = row.reason instanceof Error ? row.reason.message : '请求失败' })
        if (!Object.keys(data).length) return json({ error: '未能获取任何真实公开行情', errors, updatedAt: Date.now() }, 502)
        return json({ data, errors, source: '交易所公开 API（详见各交易对来源）', updatedAt: Date.now() })
      } catch (error) {
        console.error('market-data request failed', error)
        return json({ error: error instanceof Error ? error.message : '行情请求失败', updatedAt: Date.now() }, 502)
      }
    }

    if (url.pathname === '/api/score') {
      try {
        const market = await marketFor(symbolFrom(url.searchParams.get('symbol')))
        return json({ ...market, score: scoreFor(market), disclaimer: '评分为规则化风险研究，不构成投资建议。' })
      } catch (error) {
        console.error('score request failed', error)
        return json({ error: error instanceof Error ? error.message : '评分所需行情不可用' }, 502)
      }
    }

    if (url.pathname === '/api/alert') {
      if (request.method !== 'POST') return json({ error: '请使用 POST 请求' }, 405)
      if (!env.ALERT_API_KEY) return json({ ok: false, sent: false, error: '预警接口未启用：未配置服务端鉴权密钥' }, 503)
      if (request.headers.get('X-Alert-Key') !== env.ALERT_API_KEY) return json({ ok: false, sent: false, error: '预警接口鉴权失败' }, 401)
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ ok: false, sent: false, error: '未配置 Telegram Worker Secret' }, 503)
      try {
        const market = await marketFor(symbolFrom(url.searchParams.get('symbol')))
        if (market.fundingRate === null || Math.abs(market.fundingRate) <= .0005) return json({ ok: true, sent: false, reason: '资金费率未达到 ±0.05% 预警阈值', market })
        const posture = market.fundingRate > 0 ? '多头拥挤 / 向下清算风险上升' : '空头拥挤 / 向上清算风险上升'
        const message = `⚠️ 合约资金费率预警\n交易对：${market.symbol}\n资金费率：${market.fundingRatePercent?.toFixed(4)}%\n状态：${posture}\n标记价格：${market.markPrice}\nRSI(14)：${market.rsi14?.toFixed(2) ?? '未知'}\n大户多空账户比：${market.topLongShortAccountRatio ?? '未知'}\n\n仅供风险监测，不构成交易建议。`
        const telegram = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }) })
        const payload = await telegram.json() as { ok?: boolean, description?: string }
        if (!telegram.ok || !payload.ok) throw new Error(`Telegram 推送失败：${payload.description || telegram.status}`)
        return json({ ok: true, sent: true, reason: '已发送 Telegram 极端资金费率预警', market })
      } catch (error) {
        console.error('alert request failed', error)
        return json({ ok: false, sent: false, error: error instanceof Error ? error.message : '预警所需行情不可用' }, 502)
      }
    }


    // Public capability report: never exposes database table names, credentials, or account IDs.
    // The browser-local simulator is intentionally NOT a D1 protected trading engine.
    if (url.pathname === '/api/sim/status') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      let schemaReady = false
      let databaseConnected = false
      try {
        const rows = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sim_accounts','sim_orders','sim_positions','risk_events')"
        ).all<SchemaRow>()
        databaseConnected = true
        const found = new Set(rows.results.map(row => row.name))
        schemaReady = ['sim_accounts','sim_orders','sim_positions','risk_events'].every(name => found.has(name))
      } catch {
        // Fail closed. Lack of database access must not become an optimistic ready signal.
      }
      return json({
        mode: 'browser-local-simulation',
        serverExecutionEnabled: false,
        serverRiskLimits: { dailyRealizedLossUsdt: 20, singleOrderRiskUsdt: 5, singleOrderNotionalUsdt: 250 },
        databaseConnected,
        ledgerSchemaReady: schemaReady,
        statement: '浏览器本地模拟交易没有后端订单执行保护；服务端成交与账本迁移尚未启用。',
        checkedAt: new Date().toISOString()
      })
    }

    // All simulated order writes must enter this server-side gate.
    // Intentionally fail-closed while ledger execution and authenticated UI migration remain disabled.
    if (url.pathname === '/api/sim/orders') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      if (!env.SIM_API_KEY) return json({ error: '模拟账本接口尚未启用：缺少服务端鉴权配置' }, 503)
      if (request.headers.get('X-Sim-Key') !== env.SIM_API_KEY) return json({ error: 'Unauthorized' }, 401)
      const audit = async (accountId: string, reason: string, details: string) => {
        try {
          await env.DB.prepare('INSERT INTO risk_events(id,account_id,event_type,reason,details) VALUES (?,?,?,?,?)')
            .bind(crypto.randomUUID(), accountId, 'ORDER_REJECTED', reason, details.slice(0, 500)).run()
        } catch (e) { console.error('Risk audit unavailable', e); throw e }
      }
      try {
        const raw = await request.json() as Record<string, unknown>
        const accountId = typeof raw.accountId === 'string' ? raw.accountId : ''
        const symbol = typeof raw.symbol === 'string' ? raw.symbol : ''
        const side = raw.side
        const qty = typeof raw.qty === 'number' ? raw.qty : NaN
        const stop = typeof raw.stopPrice === 'number' ? raw.stopPrice : NaN
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId) || !supportedSymbols.has(symbol) ||
            !['long', 'short'].includes(String(side)) || !Number.isFinite(qty) || qty <= 0 ||
            !Number.isFinite(stop) || stop <= 0) {
          return json({ error: '订单字段无效；止损价为必填项' }, 400)
        }
        const account = await env.DB.prepare('SELECT id FROM sim_accounts WHERE id=?')
          .bind(accountId).first<{ id: string }>()
        if (!account) return json({ error: '模拟账户不存在；需要先完成账本初始化' }, 404)
        const loss = await env.DB.prepare(
          "SELECT COALESCE(SUM(realized_pnl_usdt),0) AS pnl FROM sim_orders WHERE account_id=? AND trading_day=date('now') AND action='CLOSE'"
        ).bind(accountId).first<{ pnl: number }>()
        // Market values are retrieved by the Worker itself, not accepted from the browser.
        const market = await marketFor(symbol)
        const mark = market.markPrice
        if (mark === null || !Number.isFinite(mark) || mark <= 0)
          return json({ error: '有效标记价不可用，拒绝下单' }, 503)
        const dailyPnl = Number(loss?.pnl ?? NaN)
        if (!Number.isFinite(dailyPnl)) return json({ error: '当日盈亏不可核对，拒绝执行' }, 503)
        const check = evaluateSimRisk({
          dailyRealizedPnl: dailyPnl, markPrice: mark, stopPrice: stop,
          quantity: qty, side: side as 'long' | 'short'
        })
        if (!check.allowed) {
          await audit(accountId, check.reason ?? 'INVALID_RISK_INPUT',
            JSON.stringify({ symbol, side, qty, stop, mark, ...check }))
          return json({ ok: false, error: '硬风控拒绝订单', ...check }, 403)
        }
        // No order is written here: never claim server-enforced execution until an
        // atomic settlement path and browser-to-server session authentication exist.
        return json({ ok: false, error: '风险检查通过，但服务端模拟成交引擎尚未启用，拒绝执行', executionEnabled: false }, 503)
      } catch (error) {
        console.error('Sim risk gate failed closed', error)
        return json({ error: '账本或行情验证失败，拒绝执行' }, 503)
      }
    }

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

      try {
        const tables = await env.DB
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
          .all<SchemaRow>()

        return json({
          ok: true,
          service: 'yiming-ai-quant',
          database: 'connected',
          tables: tables.results.map((table) => table.name),
          checkedAt: new Date().toISOString(),
        })
      } catch (error) {
        return json({
          ok: false,
          service: 'yiming-ai-quant',
          database: 'unavailable',
          error: error instanceof Error ? error.message : 'Unknown database error',
          checkedAt: new Date().toISOString(),
        }, 503)
      }
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)
    return env.ASSETS.fetch(request)
  },
}
