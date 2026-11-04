import { simApi } from './lib/simApi.ts'
import type { SimEnv } from './lib/simApi.ts'
type QueryResult<T> = { results: T[] }

type D1Statement = {
  all<T>(): Promise<QueryResult<T>>
}

type D1Database = {
  prepare(query: string): D1Statement
}

type AssetBinding = {
  fetch(request: Request): Promise<Response>
}

type Env = SimEnv & {
  ASSETS: AssetBinding
  DB: D1Database
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  ALERT_API_KEY?: string
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
  return averageLoss === 0 && averageGain === 0 ? 50 : averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
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
    futures('/fapi/v1/premiumIndex', { symbol }) as Promise<{ markPrice: string, indexPrice: string, lastFundingRate: string, nextFundingTime: number }>,
    futures('/futures/data/topLongShortAccountRatio', { symbol, period: '1h', limit: 1 }) as Promise<Array<{ longShortRatio: string, longAccount: string, shortAccount: string, timestamp: number }>>,
    futures('/fapi/v1/klines', { symbol, interval: '1h', limit: 120 }) as Promise<Array<[number, string, string, string, string, string, number]>>,
  ])
  const closes = rawKlines.map(row => Number(row[4])).filter(Number.isFinite)
  const ratio = ratioRows.at(-1)
  const fundingRate = value(premium.lastFundingRate)
  return {
    symbol, markPrice: value(premium.markPrice), indexPrice: value(premium.indexPrice), fundingRate,
    fundingRatePercent: fundingRate === null ? null : fundingRate * 100, nextFundingTime: premium.nextFundingTime,
    topLongShortAccountRatio: value(ratio?.longShortRatio), topLongAccount: value(ratio?.longAccount), topShortAccount: value(ratio?.shortAccount),
    rsi14: calculateRsi(closes), macd: calculateMacd(closes), updatedAt: Date.now(), source: 'Binance USDⓈ-M Futures Public API',
  }
}

async function okxMarketFor(symbol: string) {
  const base = symbol.replace('USDT', '')
  const instId = `${base}-USDT-SWAP`
  const [fundingRows, candleRows] = await Promise.all([
    okx('/api/v5/public/funding-rate', { instId }) as Promise<Array<{ fundingRate: string, nextFundingTime: string }>>,
    okx('/api/v5/market/candles', { instId, bar: '1H', limit: 120 }) as Promise<Array<[string, string, string, string, string, string, string, string, string]>>,
  ])
  const funding = fundingRows[0]
  const closes = candleRows.slice().reverse().map(row => Number(row[4])).filter(Number.isFinite)
  if (!funding || !closes.length) throw new Error('OKX 返回的合约行情不完整')
  const fundingRate = value(funding.fundingRate)
  const last = closes.at(-1) ?? null
  return {
    symbol, markPrice: last, indexPrice: last, fundingRate,
    fundingRatePercent: fundingRate === null ? null : fundingRate * 100, nextFundingTime: Number(funding.nextFundingTime) || null,
    topLongShortAccountRatio: null, topLongAccount: null, topShortAccount: null,
    rsi14: calculateRsi(closes), macd: calculateMacd(closes), updatedAt: Date.now(),
    source: 'OKX 永续合约公开 API（大户账户比未提供同口径数据）',
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
  if (market.fundingRate === null || market.topLongShortAccountRatio === null || market.rsi14 === null) return { value: null, state: '证据不足', warning: '缺少评分字段，不生成方向结论。', components: { fundingRate: market.fundingRatePercent, topLongShortAccountRatio: market.topLongShortAccountRatio, rsi14: market.rsi14 } }
  const funding = market.fundingRate, ratio = market.topLongShortAccountRatio, rsi = market.rsi14
  const clamp = (number: number, min: number, max: number) => Math.min(max, Math.max(min, number))
  const score = Math.round(clamp(50 - funding * 40000 + (ratio - 1) * 18 + (rsi - 50) * .22, 0, 100))
  const state = score > 70 ? '多头过热预警' : score < 30 ? '空头极度恐慌' : score >= 55 ? '温和偏多' : score <= 45 ? '温和偏空' : '中性观察'
  const warning = score > 70 ? '谨防向下扎针清算；高分不等同于追涨信号。' : score < 30 ? '谨防向上扎针清算；低分不等同于做空信号。' : '信号未达极端，仍需执行止损与仓位纪律。'
  return { value: score, state, warning, components: { fundingRate: market.fundingRatePercent, topLongShortAccountRatio: ratio, rsi14: rsi } }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const simulation = await simApi(request, env)
    if (simulation) return simulation

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
      if (!env.ALERT_API_KEY) return json({ ok: false, sent: false, error: '预警鉴权未配置' }, 503)
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
