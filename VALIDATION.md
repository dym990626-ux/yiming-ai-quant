# V2.0 验证记录

基线：GitHub main `8bded405efa912be9638d8f352f645fb20b1b9b6`，读取并安全解压原source.tar.gz。

- `npm test`：26个实际执行的测试通过，0失败。Node24.22.1，内存SQLite；行情响应显式使用测试夹具，没有向交易所提交订单或发送Telegram通知。
- 覆盖：1000U与整数记账、250U上限、含费用5U风险、20U日亏/3次连亏、UTC切日、0.5%偏移边界、10秒边界、失效行情、同键重放、同键参数冲突、并发重复/竞争开仓、真实SQLite事务故障回滚（分录插入和账户更新两处）、审计篡改检测、多空费用与净损益、止盈校验、Binance→OKX回退、CVD/VWAP样本计算、缺失研究值、鉴权、生产DB隔离、原Worker路由与评分修复。
- `npm ci --offline --ignore-scripts`：失败，ENOTCACHED（yallist依赖无缓存）。
- 在线`npm ci`：失败，代理连接EPERM；追加网络权限的重试被中断，未完成安装。
- `npm run build`：未通过，`tsc: not found`；尚未执行TypeScript/Vite编译。不能据此声称界面能成功构建。
- 尚未运行：Wrangler本地Worker/D1集成、Cloudflare预览D1兼容验证、浏览器交互与手机/桌面视觉验收、真实外部行情网络验证。
- GitHub创建远端开发分支：API403 `Resource not accessible by integration`。本地分支`dev/v2-simulation-risk`已创建；远端分支和PR尚未创建。
- 未读取或修改生产数据库，未部署环境，未启用真实交易。


## 继续验证：依赖与构建已修复

保留原提交`052270d`和`dev/v2-simulation-risk`，已创建`preserve-052270d`标签与Git bundle备份。业务源码、测试、package.json与锁文件不变；本次仅追加验证说明。

- 原26项离线测试在安装依赖前、安装后均重复通过，0失败。原始输出保存在交付目录的`baseline-tests.log`与`final-tests.log`。
- 在保留平台代理与TLS校验的情况下，为安装命令申请沙箱网络访问后，`npm ci --fetch-retries=0 --fetch-timeout=15000 --cache /tmp/yiming-npm-cache`成功，安装70个依赖。此前EPERM来自执行环境网络访问限制，不是业务源码错误；没有更换源或改写依赖锁文件。
- `./node_modules/.bin/tsc -b --force --pretty false`通过，无诊断信息。
- `npm run build`通过：Vite7.3.7，51个模块；输出dist/index.html及CSS/JS资源。仅本地构建，未部署。
- GitHub只读检查：当前连接用户为`dym990626-ux`；仓库元数据显示用户有push/admin权限，但`list_installations`返回空列表；查询协作者权限返回403 `Resource not accessible by integration`。用户的仓库权限不能证明当前集成持有Contents写入权限。本轮未再执行远端写入请求。
- 本地仓库无origin，来自已核对的上游文件树重建。GitHub CLI在受限网络中的认证检查失败，额外网络检查被中断，因此不据此断言令牌已失效，也未尝试CLI推送。
- 原提交及最终分支保存为Git bundle，另提供可用`git am`应用的代码补丁。补丁从与上游main相同的原始文件树生成，不要求本地重建提交与上游具有相同提交历史。
- 仍未运行：Cloudflare D1/Worker集成、手机与桌面浏览器验收、外部真实行情联网验收；不将构建成功等同于这些验证已完成。
