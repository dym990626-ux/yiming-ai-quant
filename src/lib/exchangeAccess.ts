/** Cloudflare Access JWT signature verification for private exchange-account reads.
 * Worker static-assets routing may omit ctx.access, so explicitly verify Access JWT.
 * Fail closed on unset policy, missing token, bad key, wrong issuer or audience.
 */
export type AccessPolicy = { ACCESS_TEAM_DOMAIN?: string; ACCESS_APP_AUD?: string }

type JWTHeader = { alg?: string; kid?: string; typ?: string }
type Claims = { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; sub?: string; email?: string }
type JwkPublic = { kty: string; kid?: string; n?: string; e?: string; alg?: string; use?: string }
const decoder = new TextDecoder()
function base64url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length > 15000) throw Error('JWT segment invalid')
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-s.length%4)%4))
  const bytes = new Uint8Array(b.length)
  for (let i=0;i<b.length;i++) bytes[i]=b.charCodeAt(i)
  return bytes
}
function parse<T>(s:string):T{
  const data = JSON.parse(decoder.decode(base64url(s))) as T
  if (!data || typeof data!=='object' || Array.isArray(data)) throw Error('JWT content invalid')
  return data
}
export async function verifyExchangeAccess(request: Request, env: AccessPolicy): Promise<{ok: true; subject: string} | {ok:false;reason:'not_configured'|'denied'}> {
  const domain=env.ACCESS_TEAM_DOMAIN?.replace(/\/$/,'')
  const aud=env.ACCESS_APP_AUD
  if(!domain || !aud || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)||! /^[a-zA-Z0-9_-]{10,200}$/.test(aud))
    return {ok:false,reason:'not_configured'}
  const token=request.headers.get('Cf-Access-Jwt-Assertion')
  if(!token || token.length>16000)return {ok:false,reason:'denied'}
  try{
    const parts=token.split('.')
    if(parts.length!==3)return {ok:false,reason:'denied'}
    const header=parse<JWTHeader>(parts[0]),claims=parse<Claims>(parts[1])
    const now=Math.floor(Date.now()/1000)
    if(header.alg!=='RS256'||!header.kid||claims.iss!==domain||
       !(typeof claims.aud==='string'?claims.aud===aud:Array.isArray(claims.aud)&&claims.aud.includes(aud))||
       !Number.isFinite(claims.exp)||claims.exp!<=now||
       (claims.nbf!==undefined && (!Number.isFinite(claims.nbf)||claims.nbf>now+30)))
      return {ok:false,reason:'denied'}
    const ctl=new AbortController()
    const timeout=setTimeout(()=>ctl.abort(),5000)
    let keys:JwkPublic[]
    try{
      const response=await fetch(domain+'/cdn-cgi/access/certs',{signal:ctl.signal,headers:{accept:'application/json'}})
      if(!response.ok)throw Error('Access public keys unavailable')
      const body=await response.json() as {keys?:JwkPublic[]}
      keys=Array.isArray(body.keys)?body.keys:[]
    }finally{clearTimeout(timeout)}
    const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.n&&k.e&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'))
    if(!jwk)return {ok:false,reason:'denied'}
    const key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:jwk.n,e:jwk.e,alg:'RS256',ext:true}, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))
    if(!valid)return {ok:false,reason:'denied'}
    return {ok:true,subject:claims.sub||'authenticated'}
  }catch{return {ok:false,reason:'denied'}}
}
