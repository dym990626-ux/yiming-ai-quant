# 一鸣 AI Quant V2.0（开发审核）

仅模拟交易。原有行情、技术指标、杠杆研究、六模块研究、历史回测、快照与设置继续保留；模拟交易改为独立 D1 账本。源码已从 `source.tar.gz` 展开到 `src/`，启动和构建不再解压旧包覆盖修改。旧压缩包仅保留历史参考，不是构建输入。

Node.js 24+。`npm ci` 安装依赖，`npm test` 执行离线测试，`npm run build` 执行 TypeScript 与 Vite 构建。`npm run dev` 的 `/api` 代理到本地 Worker 8787 端口。

## 模拟账户与原子交易

- 一个鉴权保护的共享模拟账户 `paper-1000`，初始 1000 USDT，单一持仓、可模拟多空。新账户不读取或迁移旧浏览器模拟账户，不重置旧 localStorage。
- 金额使用整数 micro-USDT（1U=1,000,000）；单笔名义仓位最多250U。必填止损，计划亏损加开平仓费与0.5%止损成交偏移预留不得超过5U。
- 单边费率0.1%，按公开永续买卖报价中间价向不利方向加入0.05%模拟成交滑点；成交相对订单参考价的绝对偏移超过0.5%即拒绝。费用向上取整到micro-USDT。
- 每日净已实现亏损达到20U（UTC）或连续亏损3笔拒绝新开仓；平仓允许。整笔交易开平仓费用归入平仓当日净已实现损益；连亏不随午夜清零，无远程重置入口。跳空损失不截断、不虚构收益；负余额照实记录并拒绝新开仓。
- 幂等键唯一，相同键和参数返回原订单，不重复请求行情或扣款；同键不同参数拒绝。账户revision实现乐观并发控制，数据库触发器在提交时重新检查资金、持仓和熔断。
- D1 `batch` 事务中，订单插入触发四项平衡分录（现金、持仓成本、费用、毛损益）及账户更新。任一SQL/触发器失败则整个事务回滚。订单及分录禁止更新/删除。审计检查现金、持仓成本、订单序号、分录数量和每单平衡，审计失败停止交易。
- 未确认订单在当前标签页sessionStorage保留原始请求，可同键重试；访问密钥仅保存在React内存，不写入浏览器存储。API必须同时配置独立`SIM_DB`和`SIM_API_KEY`，不会回退使用生产`DB`。

## 本地验证（不会执行生产操作）

`wrangler.toml` 保持原样，未执行其中任何数据库或部署操作。新配置 `wrangler.sim.toml` 仅含独立本地模拟库占位绑定。

1. 安装Node24、依赖及Wrangler开发CLI。
2. 复制`.dev.vars.example`为`.dev.vars`并设置本地唯一访问密钥。
3. `npm test` 和 `npm run build`。
4. `npx wrangler d1 execute yiming-sim-v2-local --local --config wrangler.sim.toml --file migrations/0001_simulation.sql`，仅首次在新本地库执行。
5. `npx wrangler dev --local --config wrangler.sim.toml`。在页面“模拟交易”中输入本地密钥。也可另开终端运行`npm run dev`。

本次没有创建/迁移/查询生产数据库，也没有创建远端预览数据库或部署。远端预览需另行创建全新的D1模拟库、设置专用绑定和Secret后审核；生产部署不属于本次修改。`/api/health`仍是原有生产DB健康接口，本地模拟验证不调用它。

## 行情与研究边界

Binance公开USDⓈ-M bookTicker优先，失败或数据过期时回退OKX公开USDT-SWAP ticker。买卖报价必须为有效正数；以交易所时间检查10秒过期，未来时间或失效报价拒绝交易。每笔订单服务端重新获取报价，不采信客户端自报成交价。页面定时拉取并检查时间，不以WebSocket连接状态冒充行情新鲜度。

CVD与VWAP仅计算当前交易所返回的成交样本窗口（Binance最近最多500条聚合成交；OKX最近最多100条成交），显示来源、起止时间、样本数及数量单位。Binance按标的币数量，OKX按合约张数，不混算。OI和资金费率独立读取，失败返回null并显示未知，不填造中性值；显示各自时间。费用、成交和收益仅产生于真实报价驱动的虚拟记账；测试夹具只用于离线验证，不出现在产品中。

止盈止损是页面开启、鉴权且行情可用时的尽力监测；页面关闭或断网时没有后台自动成交。5U是开仓计划预算，不是跳空损失保证；0.5%是成交偏移拒绝阈值，不会伪造阈值内成交价。断线超过10秒时开平仓都拒绝。

## 验证状态

详见 `VALIDATION.md`。离线SQLite测试运行真实迁移与触发器，但不等同于Cloudflare D1线上兼容验证。续验已完成依赖安装、TypeScript强制编译与Vite完整构建。合并前仍须完成本地Worker集成与手机/桌面浏览器验收。

---

以下为原V1项目文档，部分历史完成状态和生产部署说明仅作参考；本次不执行部署。

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
