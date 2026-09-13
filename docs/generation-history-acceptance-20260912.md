# 2026-09-12 生成历史开发版验收证据

仅列本轮实际 passed=true 且外层正常收尾的报告。保留所有失败报告，不将失败前完成的部分计作整场通过。CPU 10% / Job 4 GiB / Node 768 MiB，逐场串行；未访问用户历史数据库，未调用真实 Provider，未发布。

| 明确场景或模型 | 项数 | 原始报告 | 正常退出回执 | Job峰值 MiB |
| --- | --- | --- | --- | --- |
| standard-video /  | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-22-27-406Z/report.json) | [回执](../artifacts/history-low-load-runner/1511aa3d3f0648ffaa693295715ab49c.json) | 1,549.4 |
| 保存/正常重启/旧媒体恢复/SD2 A+B | 7 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-24-35-942Z/report.json) | [回执](../artifacts/history-low-load-runner/bcb3bbe5e18c40d1b5bdc50b73781fdd.json) | 1,594.3 |
| standard-image / gpt-image-2.5-flare | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-28-22-925Z/report.json) | [回执](../artifacts/history-low-load-runner/18d4d080838a4bb5830ef941864aa882.json) | 1,576.9 |
| budget-image / zhenzhen-image-g-v2.5-flare | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-37-53-425Z/report.json) | [回执](../artifacts/history-low-load-runner/9f5119b6260d4087a6dbd72e22a1a4db.json) | 1,559.2 |
| fal-image / gpt-image-2-fal | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-38-29-124Z/report.json) | [回执](../artifacts/history-low-load-runner/218dd806735c4b33b284165ebf49398a.json) | 1,556.6 |
| fal-image / nano-banana-pro-fal | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-39-07-458Z/report.json) | [回执](../artifacts/history-low-load-runner/0702204f3cb34de6aa4ba4569a0cecfd.json) | 1,579.4 |
| fal-image / nano-banana-2-fal | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-39-48-253Z/report.json) | [回执](../artifacts/history-low-load-runner/9993a8a2fd234816872cd31868f50427.json) | 1,584.2 |
| banana-image / gemini-3.1-flash-lite-image | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-40-28-947Z/report.json) | [回执](../artifacts/history-low-load-runner/54cac836ad6c4a41ab5fe9a09500f71b.json) | 1,585.6 |
| banana-image / gemini-3.1-flash-image | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-41-11-973Z/report.json) | [回执](../artifacts/history-low-load-runner/b0452df5f0f641a9bf8f38f04e374d29.json) | 1,591.8 |
| banana-image / nano-banana-pro | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-41-57-657Z/report.json) | [回执](../artifacts/history-low-load-runner/ce95dfd8c9b24894818e70e6a24e54f5.json) | 1,587.5 |
| banana-image / nano-banana-pro-2k | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-42-38-091Z/report.json) | [回执](../artifacts/history-low-load-runner/936f99de34a14d5a80cc8a51383bbb63.json) | 1,584.9 |
| banana-image / nano-banana-pro-4k | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-43-17-869Z/report.json) | [回执](../artifacts/history-low-load-runner/82f5622dc7c843dc9c93f52c82471c1b.json) | 1,560.5 |
| banana-image / gemini-3-pro-image | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-43-59-577Z/report.json) | [回执](../artifacts/history-low-load-runner/88595eb1b366421bbab33617fda6ab47.json) | 1,575.4 |
| budget-image / zhenzhen-image-g-v2.5-lowprice | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-48-20-414Z/report.json) | [回执](../artifacts/history-low-load-runner/15118831e0e24cc1b021437b53f488d1.json) | 1,566.6 |
| budget-image / zhenzhen-image-g-v2.5-sunburst | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-54-54-779Z/report.json) | [回执](../artifacts/history-low-load-runner/143eb9f696d7466e8a039c0a96ef16ad.json) | 1,566.4 |
| fal-video / veo3.1-fal | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T19-59-12-755Z/report.json) | [回执](../artifacts/history-low-load-runner/c7e22050cbc143d8bbf711d3af2e7a4a.json) | 1,579.8 |
| fal-video / grok-video-fal | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T20-00-00-889Z/report.json) | [回执](../artifacts/history-low-load-runner/fc52fdca30984f5c9ce97d4a87747a6e.json) | 1,554.8 |
| fal-video / grok-imagine-video-1.5 | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T20-00-41-886Z/report.json) | [回执](../artifacts/history-low-load-runner/0da8afbd551041319f68c33e76ad0fd8.json) | 1,575.0 |
| fal-video / sora-2 | 1 | [报告](../artifacts/generation-history-full-electron/2026-09-11T20-01-19-570Z/report.json) | [回执](../artifacts/history-low-load-runner/71c18cda9ee8417b869d6c9ed4c578ff.json) | 1,585.1 |

完整主进程共 19 个独立进程场景、25 项声明通过；最大 Job 提交 1671774208 bytes（1.56 GiB）。每次均 clean、exit0、强制处置0、残留0并确认退出。

完整输入场景核对错误原文件拒绝、正确原字节恢复、取消不写草稿、明确确认、同补丁丢回执重试不重复、已有节点不变、正常退出后完整节点严格相等、参考有序重复槽与实际可见解码。FAL 图像只覆盖各模型所选图生图配置；FAL 视频分别覆盖 Veo 3.1、旧 Grok、Grok 1.5 与 Sora 2 的明确配置，不代表真实渠道。香蕉 Lite 保留归档 4K，确认窗实际请求 1K。

实际 React UI 另有 [13 项报告](../artifacts/generation-history-ui/2026-09-11T20-08-42-018Z/report.json) 与 [外层回执](../artifacts/history-low-load-runner/3a29d2785a1e4471867c9e5d2f6a675a.json)：浅色、深色、366px 窄屏均完成 24→27 分页、展开 7 个结果、预览与放置回调；缺文件可重选；提交未确认与写入停止在两文件批次中只发送第一次 POST 并转只读刷新；真实浏览器时钟推进 300001ms 的挂起 fetch 显示超时、保留 2 个未确认文件且不自动重试；设置窄屏/深色及运行中切换语言也通过。该进程 peakJobBytes=1177960448（约 1.10 GiB）、exit0/clean/forced0/remaining0，临时目录已自动清理。终止错误和超时由受控 HTTP/挂起请求触发，不冒认为真实磁盘故障或服务端回滚。

验收脚本关闭冷运行不需要的全项目文件监听，保持development和六入口；在新增懒节点期间保留网络拦截至正常退出，避免中途Fetch.disable。跨模型通过不等于已最小复现Electron底层竞态。模块传输诊断可能包含正常导航期间取消的请求，不能当作所有网络均无失败的证明。

最终限定回归 56/56（约 4.34 秒），BelowNormal、Node 384 MiB、单测试并发；覆盖分页竞态、终止错误、请求期限、验收资源/诊断、平价图像、FAL 图像/视频及标准视频草稿合同。当前仍不涵盖其他未适配输入、用户数据、安装版/升级、断电或真实 Provider。下一步见当前验收清单。
