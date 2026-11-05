import type { DataSourcePreference } from '../lib/market'
import type { IntervalId, SymbolId } from '../types'

export type AppSettings = { source: DataSourcePreference; defaultSymbol: SymbolId; defaultInterval: IntervalId; compactNumbers: boolean }

export const defaultSettings: AppSettings = { source: 'auto', defaultSymbol: 'BTCUSDT', defaultInterval: '1h', compactNumbers: true }
export const settingsKey = 'yiming-quant-settings-v1'

export function readSettings(): AppSettings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(settingsKey) ?? '{}') } } catch { return defaultSettings }
}

export function SettingsPage({ settings, onChange }: { settings: AppSettings; onChange: (next: AppSettings) => void }) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value })
  return <main className="backtest-page settings-page">
    <div className="backtest-heading"><div><div className="eyebrow">本地偏好 · 不含交易账户</div><h1>设置</h1><p>设置仅存储于当前浏览器。数据源设置会在下一次刷新行情时生效。</p></div></div>
    <section className="settings-card">
      <h2>行情数据</h2>
      <label>首选数据源<select value={settings.source} onChange={e => update('source', e.target.value as DataSourcePreference)}><option value="auto">自动：Binance 优先，OKX 备用</option><option value="binance">仅 Binance（失败时明确报错）</option><option value="okx">仅 OKX</option></select></label>
      <p className="backtest-note">公开接口可能因网络或区域限制不可达；平台不会伪造行情或连接状态。</p>
    </section>
    <section className="settings-card settings-grid">
      <div><h2>默认品种</h2><select value={settings.defaultSymbol} onChange={e => update('defaultSymbol', e.target.value as SymbolId)}><option value="BTCUSDT">BTC/USDT</option><option value="ETHUSDT">ETH/USDT</option><option value="SOLUSDT">SOL/USDT</option></select></div>
      <div><h2>默认周期</h2><select value={settings.defaultInterval} onChange={e => update('defaultInterval', e.target.value as IntervalId)}><option value="1m">1 分钟</option><option value="5m">5 分钟</option><option value="15m">15 分钟</option><option value="1h">1 小时</option><option value="4h">4 小时</option><option value="1d">1 天</option><option value="1w">1 周</option></select></div>
    </section>
    <section className="settings-card"><h2>显示</h2><label className="toggle-row"><input type="checkbox" checked={settings.compactNumbers} onChange={e => update('compactNumbers', e.target.checked)} /> 成交量和成交额使用紧凑数字格式</label></section>
    <button className="reset" onClick={() => { localStorage.removeItem(settingsKey); onChange(defaultSettings) }}>恢复默认设置</button>
  </main>
}
