import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyExchangeAccess } from '../src/lib/exchangeAccess.ts'
import { readPrivateExchange } from '../src/lib/exchangeReadOnly.ts'

test('private account gateway fails closed without Cloudflare Access policy',async()=>{
 const result=await verifyExchangeAccess(new Request('https://example.com/api/exchange/read'),{})
 assert.deepEqual(result,{ok:false,reason:'not_configured'})
})
test('configured Access policy still refuses missing or forged JWT',async()=>{
 const env={ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com',ACCESS_APP_AUD:'this-is-a-test-aud'}
 assert.deepEqual(await verifyExchangeAccess(new Request('https://example.com/api/exchange/read'),env),{ok:false,reason:'denied'})
 const request=new Request('https://example.com/api/exchange/read',{headers:{'Cf-Access-Jwt-Assertion':'fake.jwt.token'}})
 assert.deepEqual(await verifyExchangeAccess(request,env),{ok:false,reason:'denied'})
})
test('exchange calls refuse missing secrets and cannot reach private upstream without config',async()=>{
 await assert.rejects(()=>readPrivateExchange('binance','balances',{}),/BINANCE_SECRETS_MISSING/)
 await assert.rejects(()=>readPrivateExchange('okx','positions',{}),/OKX_SECRETS_MISSING/)
})
test('Binance account projection only contains nonzero balances; signed request is GET',async()=>{
 const old=globalThis.fetch
 try{
  globalThis.fetch=async(req,opts)=>{
   const url=String(req)
   assert.match(url,/^https:\/\/api\.binance\.com\/api\/v3\/account\?/)
   assert.match(url,/signature=[a-f0-9]{64}/)
   assert.equal(opts?.method,'GET')
   return Response.json({balances:[{asset:'BTC',free:'0.123',locked:'0'},{asset:'ETH',free:'0',locked:'0'}],canTrade:false})
  }
  const result=await readPrivateExchange('binance','balances',{BINANCE_RO_API_KEY:'only-read-key',BINANCE_RO_API_SECRET:'local-test-secret'})
  assert.equal(result.records.length,1)
  assert.deepEqual(result.records[0],{asset:'BTC',free:.123,locked:0})
  assert.equal(result.warning,'')
  assert.ok(!JSON.stringify(result).includes('only-read-key'))
 }finally{globalThis.fetch=old}
})
test('OKX signature is GET with ISO time and no passphrase leakage',async()=>{
 const old=globalThis.fetch
 try{
  globalThis.fetch=async(req,opts)=>{
   assert.equal(String(req),'https://www.okx.com/api/v5/account/positions')
   assert.equal(opts?.method,'GET')
   assert.match(opts?.headers?.['OK-ACCESS-SIGN'],/^[A-Za-z0-9+/]+={0,2}$/)
   return Response.json({code:'0',data:[{instId:'BTC-USDT-SWAP',pos:'2',avgPx:'100',markPx:'110',liqPx:'65',upl:'20',lever:'2',posSide:'long',mgnMode:'isolated'}]})
  }
  const result=await readPrivateExchange('okx','positions',{OKX_RO_API_KEY:'test-key',OKX_RO_API_SECRET:'test-secret',OKX_RO_PASSPHRASE:'test-pass'})
  assert.equal(result.records.length,1)
  assert.equal(result.records[0].qty,2)
  assert.ok(!JSON.stringify(result).includes('test-pass'))
 }finally{globalThis.fetch=old}
})
