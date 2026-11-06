import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDepth } from '../src/lib/depth.ts'
const sample={bids:[['100','2'],['99','3'],['97','0']],asks:[['101','1'],['102','4']],ts:String(Date.now())}
test('public bid/ask depth validates, calculates notional, spread and imbalance',()=>{
 const x=normalizeDepth(sample,'OKX','BTCUSDT',12345)
 assert.equal(x.bidNotional,497)
 assert.equal(x.askNotional,509)
 assert.equal(x.bestBid,100)
 assert.equal(x.bestAsk,101)
 assert.equal(x.imbalance,(497-509)/1006)
 assert.equal(x.fetchedAt,12345)
 assert.equal(x.bids.length,2)
})
test('invalid/crossed books fail closed',()=>{
 assert.throws(()=>normalizeDepth({bids:[['100','1']],asks:[['99','1']]},'Binance','BTCUSDT'))
 assert.throws(()=>normalizeDepth({bids:[],asks:[]},'OKX','BTCUSDT'))
 assert.throws(()=>normalizeDepth({bids:[['x','1']],asks:[['100','1']]},'OKX','BTCUSDT'))
})
