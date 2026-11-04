# 一鸣 AI Quant V1.0

专业、轻量的数字货币行情研究终端。V1.0 只提供真实公开市场数据与基于历史 K 线计算的技术指标；不包含实盘交易、虚构 AI 结论、虚构回测或模拟交易结果。

## 本地运行

```bash
npm install
npm run dev
```

打开终端显示的本地地址。生产检查与构建：

```bash
npm run build
npm run preview
```

## 数据与限制

- 首选数据源：Binance Spot REST API 和 WebSocket（无需 API Key）；若其因地区或网络限制不可用，自动回退至 OKX Spot 公开 REST API，并在页面中标明实际来源。OKX 回退模式每 10 秒刷新一次公开行情。
- 支持 BTC/USDT、ETH/USDT、SOL/USDT，及 1m、5m、15m、1h、4h、1d、1w 周期。
- 当公开接口不可达、被网络/区域限制或断线时，页面会显示错误或“数据已过期 · 重连中”；不会回退为模拟行情。
- 技术指标为前端按时间排序的已载入 K 线计算：MA 7/25/99、EMA 12/26、RSI 14、MACD 12/26/9、Bollinger 20/2 和成交量。指标不使用未来 K 线。

## Cloudflare Pages 部署

已提供 `wrangler.toml` 和 `public/_headers`。

1. 将仓库推送至 GitHub/GitLab。
2. 在 Cloudflare Pages 创建项目并连接该仓库。
3. Framework preset 选择 **Vite**；构建命令填写 `npm run build`，构建输出目录填写 `dist`。
4. 不需要环境变量或密钥，保存并部署。

也可使用 Wrangler：`npx wrangler pages deploy dist --project-name yiming-ai-quant`（先运行 `npm run build`）。

### 上线前验收

- 运行 `npm run build`，确认 TypeScript 与 Vite 均通过。
- 打开首页，切换 BTC、ETH、SOL 及至少两个 K 线周期；确认数据来源、更新时间与异常提示正确。
- 打开历史回测，确认数据范围、样本内外指标、资金曲线和交易明细均来自当次公开 K 线。
- 打开模拟交易，确认其标记为虚拟资产，且不会要求或使用任何交易所账户信息。
- 在 Cloudflare Pages 配置 `npm run build` / `dist` 后，确认生产域名能访问公开 REST 数据；若数据源不可达，页面必须显示错误或过期状态。

## 完成情况

### 当前线上地址

https://divine-wood-aa20.floral-sun-f603.workers.dev/

- [x] 响应式 React + TypeScript + Vite 终端布局
- [x] 三币种、公开 REST K 线、周期切换、24h 行情
- [x] WebSocket 最新成交更新、指数退避重连、失效状态
- [x] K 线、成交量和 MA/EMA/Bollinger 叠加；RSI/MACD 当前值
- [x] 六 AI、回测、模拟交易、设置的诚实预留页
- [x] 基础历史回测：真实当次载入 K 线、MA(7/25) 示例规则、下一根开盘成交、手续费/滑点、权益、交易明细与核心风险指标
- [ ] 六 AI 的独立研究逻辑与证据归档
- [ ] 可持久化历史数据版本、样本内/样本外划分、多策略及完整资金曲线图
- [ ] 虚拟资产模拟交易引擎

下一阶段建议先加入可版本化的历史 K 线存储与无未来数据的回测引擎，再将策略结果供“策略研究”模块引用。
