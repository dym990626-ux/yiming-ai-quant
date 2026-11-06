/** Exchange-public Binance USD-M force-order feed.
 * Data represents broadcast liquidation order snapshots only.
 * It is NOT a full liquidation tape and must never be described as individual whale positions.
 */
export type LiquidationPrint = {
 id: string; time: number; symbol: string; side: 'BUY' | 'SELL';
 price: number; quantity: number; notional: number; source: 'Binance USD-M';
}
export function parseBinanceLiquidation(raw: unknown): LiquidationPrint | null {
 if (!raw || typeof raw !== 'object') return null
 const row = raw as Record<string,unknown>
 const order = row.o
 if (row.e !== 'forceOrder' || !order || typeof order !== 'object') return null
 const x = order as Record<string,unknown>
 if (!['BTCUSDT','ETHUSDT','SOLUSDT'].includes(String(x.s)) ||
     !['BUY','SELL'].includes(String(x.S))) return null
 const time = Number(x.T ?? row.E)
 const price = Number(x.ap ?? x.p), quantity = Number(x.z ?? x.q)
 const notional = price * quantity
 if (![time,price,quantity,notional].every(Number.isFinite) ||
     time <= 0 || price <= 0 || quantity <= 0) return null
 return {id:`${String(x.s)}:${time}:${String(x.S)}`,time,symbol:String(x.s),
   side:x.S as 'BUY'|'SELL',price,quantity,notional,source:'Binance USD-M'}
}
export function openBinanceLiquidationSocket(
 symbol: string, onLiquidation: (value: LiquidationPrint)=>void
): WebSocket {
 const socket=new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@forceOrder`)
 socket.onmessage=event=>{
  try {
   const item=parseBinanceLiquidation(JSON.parse(event.data))
   if(item)onLiquidation(item)
  }catch { /* reject malformed exchange messages */ }
 }
 return socket
}
