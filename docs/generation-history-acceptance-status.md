# 生成历史修复：当前验收清单

更新：2026-09-12。当前支持范围已验收并获准纳入 v3.1.6；未适配输入、用户旧库、安装升级、断电、真实 Provider 与外部设备仍未完成且不视为通过。这是证据索引，不是测试报告；历史时间线保留在 [roadmap](../roadmap.md)。

## 当前恢复进展（覆盖下方旧阻塞状态）

本轮已核对完整主进程 **19个独立场景、25项通过**，另有实际 React UI **1个进程、13项通过**；20个通过进程全部正常退出、强制处置0、残留0，最大Job提交1671774208 bytes（1.56GiB）。[逐场原始报告与回执索引](generation-history-acceptance-20260912.md)。覆盖核心7项、标准图像/视频各1项、平价三模型、FAL图像三模型、普通香蕉六模型、FAL视频四模型，以及分页、终止错误、请求超时、主题/窄屏与运行中语言切换。最终限定回归56/56（约4.34秒）。整体仍未完成，尚缺范围见下表。

验收专用 Vite 在 hmr=false 时仍默认监听整个项目目录；仅关闭 HMR 不会移除该监听。现通过 configResolved 插件显式设置 watch=null（普通配置合并会丢弃 null），保留 development、全部六个入口和源码转换，启动及预热后断言 NoopWatcher/空监听。产品 Vite 配置未修改，CPU10%/Job4GiB/Node768MiB 上限不变。小型真实 Vite 配置文件/HTTP 夹具已验证源码与 public 文件仍能读取。完整主进程通过场景 Job 峰值约1.51–1.59GiB，UI场景约1.10GiB；不据此解释此前原生异常或用户整机死机。

| 本轮实际通过 | 报告 | 外层正常收尾证据 |
| --- | --- | --- |
| 保存等待、正常退出、同 userData 找回，旧图片/视频显式恢复与丢回执去重，SD2 两次生成 A/B 重启保留和播放，共7项 | [核心完整验收](../artifacts/generation-history-full-electron/2026-09-11T19-24-35-942Z/report.json) | [回执](../artifacts/history-low-load-runner/bcb3bbe5e18c40d1b5bdc50b73781fdd.json)，峰值1671774208 bytes |
| 工坊 Grok1.5 视频独立历史输入，原文件找回/保存重启/精确字节与可见参考 | [视频输入](../artifacts/generation-history-full-electron/2026-09-11T19-22-27-406Z/report.json) | [回执](../artifacts/history-low-load-runner/1511aa3d3f0648ffaa693295715ab49c.json)，峰值1624682496 bytes |
| GPT2.5 Flare 图像独立历史输入，三有序槽含重复内容，原文件找回/保存重启/完整节点相同与可见参考 | [标准图像输入](../artifacts/generation-history-full-electron/2026-09-11T19-28-22-925Z/report.json) | [回执](../artifacts/history-low-load-runner/18d4d080838a4bb5830ef941864aa882.json)，峰值1653456896 bytes |
| 平价 Lowprice/Flare/Sunburst、FAL图像3模型、普通香蕉6模型、FAL视频4模型逐模型完整输入 | [逐场索引](generation-history-acceptance-20260912.md) | 16份对应回执均exit0/clean/forced0/remaining0 |
| 实际React分页、恢复异常与300秒超时不重试、设置及语言切换，共13项 | [UI报告](../artifacts/generation-history-ui/2026-09-11T20-08-42-018Z/report.json) | [回执](../artifacts/history-low-load-runner/3a29d2785a1e4471867c9e5d2f6a675a.json)，峰值1177960448 bytes |

上述报告 passed=true，真实开发版 Electron/main/App/后端，自建临时数据库；外层 exit0/clean/forced0/remaining0/verified=true。Provider 均为受控本地边界，不调用真实渠道，不证明安装升级或用户旧库。

失败保留事实：19-25-24 图像以懒加载占位节点的 measured 尺寸作基线导致严格比较失败，已改等待实际编辑器；19-26-28 实际编辑器等待超时，新增有界模块传输诊断后的19-28-22通过不能解释此前间歇等待原因。19-29-10-432Z 平价 Flare 已完成重启数据/字节验证，但启动弹窗的全局 locator handler 与脚本直接点击冲突，最终整场失败；去掉重复点击后，19-37-53及之后对应模型已各自通过。以上失败均保留且不计通过。

后续模块等待诊断：19-34-33-897Z在120秒后仍有ReuseResultToggle/LazyVideo/PromptTextarea模块pending，单纯延长等待不足。实际Playwright实现表明撤销最后一条route会全局Fetch.disable并切换缓存；本场景恰在node.add触发懒模块加载时撤销。现保留该route至正常退出（后续请求仍continue），避免中途切换拦截。随后16个不同模型场景各一次串行通过。属于该调整后的实际跨模型证据，不宣称已用最小对照复现Electron底层原因。

当前授权内的核心、已适配明确模型和实际异常UI已逐项完成；其他未适配输入、安装版及用户数据边界保持未完成，不扩大本轮结论。下方旧时间线保留用于追溯，涉及“最新”“尚未实跑”以本节为准。

## 历史阻塞与运行规则（9月11日记录，当前结果见上）

**最新覆盖记录：** session79536，资源门CPU14%/空闲43.2GiB通过后仅运行一次。报告[2026-09-11T01-08-56-821Z](../artifacts/generation-history-full-electron/2026-09-11T01-08-56-821Z/report.json)确认hmr=false/reactFastRefresh=false，但仍waiting-for-canvas、Node30836 heap OOM/exit134、cases=[]。启动Electron前heapUsed649246384bytes，最后791780336bytes；关闭HMR不足以解决。外层[55eb827b8b204f5bbee91bbe5ef8cf24](../artifacts/history-low-load-runner/55eb827b8b204f5bbee91bbe5ef8cf24.json)peakJob2878959616bytes、强制处置5/剩余0/verifiedtrue，精确路径/父PID复查无残留。失败临时数据保留。

本轮只给现有有界数字采样补依赖扫描、逐入口序号、等待空闲/完成的固定阶段，6/6小检查约687ms、脚本语法通过。没有二次启动，不增加资源、不发布；新增细分尚未实际采集。下方88018及“关闭后尚未实跑”是此前记录，以本段为准。下一步应按细分证据定位预热占用，而非再次猜测配置或将失败当通过。

最新单次VideoInputPersist（session88018）启动前CPU10%/空闲105.1GiB、无遗留，原门通过。实际报告停在waiting-for-canvas，Node17452明确JavaScript heap OOM/exit134；最后采样heapUsed约760.6MiB。外层已强制处置5个自有残留，剩余0；失败临时数据保留。该证据解释本次失败，不直接解释此前0xC0000005或用户整机死机。

- 单场景、CPU 10% 硬上限、Job 总提交 4 GiB、BelowNormal、软件渲染、互斥。不并行、不全量、不自动循环重试、不关闭用户程序。
- 验收 Node old-space 768 MiB，Go 软目标 512 MiB，不替代 Job 总量限制。最新实际Electron连接已读回768 MiB旗标；不证明画布稳定或原生内存受该旗标限制。
- Vite 推测性转换已关闭；六个显式入口保留并逐项转换。最新实际预热完成，但加载时Node堆耗尽。验收脚本进一步关闭本轮无需使用的HMR/Fast Refresh Babel转换，仍保持development/JSX开发转换和全部源码；5项小夹具通过，完整峰值改善尚未验证。产品vite.config.ts不变。
- 只测试新建的自有临时数据，不读取 retained/historical 或用户项目数据库。失败临时目录保持原状，不擅自清理。
- 外层runner新增有界Job成员收尾：排除自己，打开进程句柄后核验同一Job才终止；强制处置不能算通过，回执记录剩余数和验证状态。空闲Probe实测残留1→0、独立自有哨兵不受影响，[回执](../artifacts/history-low-load-runner/419a5ff61c3147d6b0d6a80ba5451e3b.json)峰值113582080 bytes；不是Electron正常退出或原生崩溃修复证明。实际客户端未重启。
- 独立verifier-diagnostics.json已实际采到Node17452在等待画布阶段heapUsed从约644.8MiB升至760.6MiB，RSS最后约1757MiB。仅PID/运行时、阶段和数字内存、最近24条/16KiB，不是连续峰值或原生异常栈；最后GC/退出134补足本次堆耗尽证据。不能据此推出所有历史失败同因。
- 随后单次小型TransportProbe正常退出：[9种受控组合](../artifacts/generation-history-transport/2026-09-11T00-57-58-741Z.json)中真实本地HTTP均200，旧CDP fulfill+过滤器的status0冲突仍按预期复现；这是诊断通过，不是全部HTTP行为正常。[外层回执](../artifacts/history-low-load-runner/9403e2faa47d4b3f9b6959c5b1bdfa51.json)峰值331378688 bytes约316MiB、exit0、残留0、强制处置0。无App/Vite/数据库/Provider，本次自有临时profile已清理；不能排除完整加载时的0xC0000005。

## 历史开发版证据（不自动覆盖当前改动）

三个报告本轮重新读取，均为 passed=true、errors=[]、providerCalls=0、installed=false。不是当前全树、所有模型、安装升级或断电恢复通过；第一份没有 pageCrashes/resourceMode 字段，缺失不等于零。

| 用户关心的结果 | 报告 | 证据范围 |
| --- | --- | --- |
| 保存、正常退出、同 userData 重启找回 | [完整主进程 5 项](../artifacts/generation-history-full-electron/2026-09-10T17-32-15-850Z/report.json) | 等待保存、后端关闭/注销、同数据重启；自有临时数据 |
| 改提示词生成 A/B，两版均可查、重启可播放 | [实际 SD2 按钮 2 项](../artifacts/generation-history-full-electron/2026-09-10T18-33-50-086Z/report.json) | 完整主进程与持久分组，Provider 为受控本地 HTTP |
| 旧图片/视频找回、放回不重复、重启可用 | [完整主进程 5 项](../artifacts/generation-history-full-electron/2026-09-10T17-32-15-850Z/report.json) | 合成旧文件、丢回执重试、固定身份/原字节/解码播放；非用户旧库 |
| 标准 GPT 图像历史新建独立输入草稿 | [标准图像 1 项](../artifacts/generation-history-full-electron/2026-09-10T21-22-15-040Z/report.json) | 错文件拒绝、正确内容找回、同补丁只新增一次、完整节点重启与三槽预览 |

## 当前代码与下一项必要验收

| 范围 | 当前事实 | 尚缺证据 |
| --- | --- | --- |
| 核心保存/重启/旧文件找回 | 本轮完整开发版7项通过，见逐场索引 | 用户旧库、安装版/升级/断电不在本轮证据内 |
| 历史分页 | 实际React浅色/深色/366px均完成24→27分页、去重、展开与预览 | 用户真实大库与安装版不在本轮证据内 |
| 参考找回终止错误 | 实际React对提交未确认/写入停止各只发第一POST，停止批次并保留只读刷新 | 受控HTTP合同不替代真实磁盘故障 |
| 请求期限 | 实际浏览器挂起fetch推进300001ms后显示超时、保留2个未确认文件且不重试 | 客户端取消不等于服务端回滚；真实网络故障未注入 |
| 共用图像参考转换 | 标准、平价、FAL、香蕉完整客户端场景均核对错误文件拒绝、正确原字节与有序可见参考 | 受控请求不是真实 Provider |
| Grok 完整视频输入 | Grok1.5 6秒模型完成原文件恢复/确认/保存重启/可见预览 | 不推广到其他模型与模式 |
| 平价 Image G2.5 | Lowprice/Flare/Sunburst三模型各自完整输入场景通过 | 不推广为实际Provider生成 |
| FAL 图像 | GPT2、香蕉Pro、香蕉2三模型各自完整输入场景通过 | 本轮为明确图生图配置，不推广为所有模式/实网Provider |
| FAL 视频 | Veo3.1、旧Grok、Grok1.5、Sora2四模型均完成实际确认、旧文件找回、保存重启、完整节点相等与可见原字节预览 | 不推广为真实Provider请求或未覆盖模式 |
| 普通工坊香蕉 | 六模型各自完成找回/保存重启/可见预览，Lite归档4K保留且请求1K提示已确认 | 不推广为实际Provider生成或其他输入语义 |
| 其他输入与任务缓存 | 仍有未适配项；不完整/身份不明时严格拒绝 | 对应输入语义、固定参考、确认与持久化，不猜默认值 |
| 用户数据、安装版/升级等 | 未验收，不访问用户历史数据库 | 对应环境与授权内证据，临时夹具不能替代 |

最终限定十文件回归 **56/56**（约4.34秒），BelowNormal、Node堆384MiB、单测试并发。实际UI与完整客户端报告如上；受控HTTP/合成素材仍不替代真实Provider、用户数据库或安装版。v3.1.6 只发布已列出的支持范围，外部证据按明确授权后补。

随后新增 FAL 最终草稿请求表达式检查 **1/1**（约 808ms），涵盖四模型六配置，包括旧Grok两模式和Sora明确文本模式。精确node.add数据重入源码中的参数默认读取、collect/mention和FAL裁剪/请求构造，非图像参数逐项相同；固定资产身份与有序别名槽保持，Sora文本忽略原先未发送的参考。未挂载React、未执行后端HTTP/上传或读取媒体字节；不扩大为客户端验收通过。仍按384MiB低优先级串行，无客户端/资源重试/发布。

## 已知失败（不计通过）

| 报告 | 实际结果 |
| --- | --- |
| [最新带采样尝试](../artifacts/generation-history-full-electron/2026-09-11T01-00-01-245Z/report.json) | waiting-for-canvas后Node17452 heap OOM/exit134、cases=[]。[最后采样](../artifacts/generation-history-full-electron/2026-09-11T01-00-01-245Z/verifier-diagnostics.json)heapUsed760.6MiB；[外层回执](../artifacts/history-low-load-runner/d79335e6c1664bf5823094ac3709a0f6.json)peakJob2881241088 bytes、强制处置5、残留0。新HMR关闭尚未实跑，未计通过。 |
| [最新实际尝试](../artifacts/generation-history-full-electron/2026-09-11T00-40-54-666Z/report.json) | 预热完成、electron-connected、768MiB旗标读回；随后验证器退出-1073741819/0xC0000005，cases=[]，没有完整finally。[外层回执](../artifacts/history-low-load-runner/d164762454674b03a4dc4c3abb055811.json)峰值2824511488 bytes约2.63GiB，未达4GiB；原因未明，不推断OOM解决。测试Electron26988正常关窗5秒未退出，身份复核后强制结束；随后检查原验证器/主进程/子进程均无，原临时目录保留。 |
| [首次启动](../artifacts/generation-history-full-electron/2026-09-10T23-23-38-068Z/report.json) | electron-connected 后 esbuild 分配失败，退出 1，未完成收尾 |
| [串行入口尝试](../artifacts/generation-history-full-electron/2026-09-10T23-33-08-063Z/report.json) | 到达画布并 seed，renderer OOM；[Job 峰值](../artifacts/history-low-load-runner/314d2a72fe444902a48141e8ac6d6ffe.json)接近 4 GiB；仅本次测试主进程被强制结束，不算正常退出 |
| [此前预热尝试](../artifacts/generation-history-full-electron/2026-09-10T23-50-48-573Z/report.json) | Node 预热堆耗尽，未启动 Electron，cases=[]；[子退出 134 / 峰值约 2.23 GiB](../artifacts/history-low-load-runner/6814e7a070b8450793a22d86cd2c6ffc.json)，更早失败不代表优化成功 |

中途报告的零错误/崩溃字段不能证明正常收尾。尚未查明用户整机死机原因。

## 恢复执行顺序

1. 当前授权内的核心保存/正常重启/旧文件找回、已适配模型完整输入和实际React异常UI已完成，不重复运行制造进度。
2. 其他输入只有在明确输入语义和固定身份可验证时再逐项接入；用户旧库、安装升级、断电与真实Provider必须在对应环境和授权下另行验收，临时夹具不能替代。
3. 版本、打包、提交推送和发布继续暂停，发布需要重新明确授权。
