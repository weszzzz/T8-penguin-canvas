# seedance.nz Suno V6 三动作合同与复现

更新：2026-09-12。适用于音频节点 → Suno → 贞贞的平价AI小屋。权威来源为当前 [seedance.nz API 文档](https://api.seedance.nz/docs/llms.txt) 与 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance\skill.md` / `nodes.py`；工坊渠道 `ai.t8star.org` 的展示名和参数映射不能复用到这里。

## 共同调用

- Base URL：`https://api.seedance.nz`；请求头 `Authorization: Bearer <API_KEY>` 与 `Content-Type: application/json`。
- 提交：`POST /v1/music/generations/{action}`；响应中的 `task_id` 是唯一恢复身份。
- 查询：`GET /v1/music/tasks/{task_id}`。首次约 3 秒后查询，之后约 5–10 秒一次；已拿到 `task_id` 后只能查询原任务，不能因超时重发付费 POST。
- 本地素材先经既有 `/v1/files/upload` 上传为公网 URL。密钥只从设置或进程环境读取；工作流、报告和日志不得保存密钥、任务 ID、签名 URL 或真实产物 URL。

## 动作合同

| 操作 | action | 必填 | 结果族 |
| --- | --- | --- | --- |
| `suno-create-model` | `create-model` | `model="suno"`、`name`、6–24 个有序 `audio_urls` | `model`；完成结果读取 `model_id` |
| `suno-upload-cover` | `upload-cover` | `model="suno"`、恰好一个 `audio_url`，以及下述二选一模式 | `audio` |
| `suno-upload-extend` | `upload-extend` | `model="suno"`、恰好一个 `audio_url`、`continue_at` | `audio` |

共同 V6 版本只允许 `v6`、`v6-wild`、`v6-mini`。`custom_model_id` 可替代版本；一旦填写就省略 `version`，并且不得同时填写 `persona_id`。

`suno-upload-cover` 有两种互斥模式：

- `custom=false`：必须填写 `gpt_description`（最多 3000 个 Unicode 字符）；不发送 `prompt`、`tags`、`title`、`negative_tags`、三个权重、`auto_lyrics`、`persona_id`、`duration_s` 或 `max_mode`。
- `custom=true`：不发送 `gpt_description`；`instrumental=false` 时 `prompt` 必填，`instrumental=true` 时可省略。`max_mode` 只允许在此模式启用。

`suno-upload-extend` 固定为自定义模式，禁止发送 `custom`、`instrumental`、`gpt_description`。`continue_at >= 1`，并且必须严格小于源音频经 ffprobe 得到的真实时长。

两种上传动作的其余字段：`prompt` 最多 5000 字符、`tags` 最多 1000 字符、`title` 最多 80 字符；`negative_tags`；`style_weight` / `weirdness` / `audio_weight` 均为 0–1（零值有效）；`auto_lyrics`；`vocal_gender` 只允许 `Male` / `Female`；`duration_s` 为 10–360 的整数；`variety` 只允许 `off` / `normal` / `high` / `extra` / `max`；`max_mode`；`audio_format` 只允许 `mp3` / `m4a` / `wav`。

## 无密钥工作流

- [创建自定义模型](workflows/suno-create-model.json)：导入 6–24 段音频，完成后文本结果为 `model_id`。
- [上传翻唱·灵感描述模式](workflows/suno-upload-cover-description.json)：导入一段音频，`custom=false`。
- [上传翻唱·自定义模式](workflows/suno-upload-cover-custom.json)：导入一段音频，`custom=true`。
- [上传音频续写](workflows/suno-upload-extend.json)：导入一段音频，并保证续写起点小于源时长。

工作流由 `node scripts/generate-suno-v6-workflows.cjs` 生成；用 `node scripts/generate-suno-v6-workflows.cjs --check` 检查漂移。文件只保存表单参数和空素材槽，不含凭据或实网身份。

实网验证器 `scripts/verify-suno-v6-actions-live.cjs` 默认串行覆盖三个动作；`SUNO_V6_ACTIONS_SCOPE=create-model` 可在 Cover / Extend 已通过后只验证模型动作，避免重复付费提交。Create Model 的 6–24 条已解码音频从 `SUNO_V6_CREATE_MODEL_SOURCE_DIR` 指定的工作区 `output` 子目录读取，不把源路径写入报告。

## 实网证据（2026-09-12）

- [Cover / Extend 报告](../output/suno-v6-actions-live-2026-09-12T02-30-40-699Z/report.json)：两个动作各只提交一次、各在 6 次查询后成功；每个动作均返回 2 段 MP3 与 2 张 360×360 JPEG。四段音频均通过 ffprobe 与完整解码，四张图片均通过 Sharp 解码。该轮 Create Model 使用 6 段合成正弦测试音，任务明确终态失败并按 API 规则退款，不计通过，也未自动重发。报告 SHA-256：`3CC60595464154B6A78114E230F483BF71EA2D95A1546D5183CD2B957DC83489`。
- [Create Model 修正案例](../output/suno-v6-actions-live-2026-09-12T02-37-00-568Z/report.json)：使用[既有 Suno V6 实网报告](../output/suno-v6-live-2026-09-11T17-09-26-045Z/report.json)中 3 个版本各 2 段、已完整解码的真实音乐作为 6 个有序输入；本案例只提交 Create Model 一次，34 次查询后成功，`model_id` 为 36 位标准 UUID 外形。报告不保存 UUID 本身。报告 SHA-256：`924A05554A13B57923E81E971470B20DDA95B9C5B38B3A6953B1B8D2C6176AEC`。
- 两份动作报告都只保存动作名、终态、查询次数、媒体元数据与散列；不含 API Key、任务 ID、模型 ID、签名 URL 或实网产物 URL。实网范围是 T8 Provider 直连及产物验证，不等同于 GUI 保存重启或安装版验收。

## 验收边界

专项合同测试必须覆盖动作白名单、字段泄漏、模式裁剪、版本/自定义模型互斥、Unicode 长度、权重/时长枚举、6–24 与单音频数量、源时长探测、`model_id` 提取和工作流无敏感值。实网只串行提交每个新动作一次；媒体动作须下载后 ffprobe 并完整解码，模型动作须确认非空 `model_id`。GUI 保存重启、安装版和发布属于独立证据，不能由 API 通过替代。
