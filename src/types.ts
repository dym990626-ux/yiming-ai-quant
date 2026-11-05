export type SymbolId = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'
export type IntervalId = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closed?: boolean
}

export interface Ticker {
  price: number
  changePercent: number
  high: number
  low: number
  volume: number
  quoteVolume: number
  updatedAt: number
  source: string
}

export type ConnectionState = 'loading' | 'connected' | 'reconnecting' | 'stale' | 'error'
