# T8 Penguin Canvas Runbook

## 用途

T8 Penguin Canvas 的源码、开发启动、检查与跨平台入口说明。具体工程保护规则仍以 `AGENTS.md` 为准。

## Canonical Path

| 平台 | 路径 | 状态 |
|---|---|---|
| macOS | `/Users/wes/Documents/T8-penguin-canvas` | 当前仓库 |
| Windows | `E:\PenguinPravite\T8-penguin-canvas` | 仅 Windows 宿主使用 |

- Codex 项目 ID：`7d7159ce-4d74-4c4b-b4b5-7b00da870c2f`（项目名：`t8 画布`）。
- Git `origin`：`https://github.com/weszzzz/T8-penguin-canvas.git`；这是当前读写远端，不能从 `package.json` 的上游元数据猜测推送目标。
- macOS 当前默认分支为 `main`，只用于读取、拉取和检查，不启动开发服务。
- 代码开发必须在非 release 的 `codex/*` 分支进行；`main` 上 `npm run worktree:development` 失败属于预期保护。
- 历史 integration 与 release 目录不是日常开发入口。

## 安装

```bash
npm install
npm --prefix backend install
```

## 开发启动入口

两个入口都只能在获准的非 release `codex/*` 分支使用。启动前必须先执行：

```bash
npm run worktree:development
```

macOS 图形入口：

```bash
./start-dev.command
```

当前图形脚本本身未内置 worktree role 门，所以上述手动预检不可省略；在门禁接入脚本前，不得从 `main` 或 release 路径直接运行。

终端入口：

```bash
npm run dev
```

- 前端：`http://127.0.0.1:11422/`
- 后端健康检查：`http://127.0.0.1:18766/api/status`

## 健康检查

```bash
npm run worktree:check
npm run type-check
```

实际代码修改前，进入获准的 `codex/*` 分支后再运行：

```bash
npm run worktree:development
```

## 更新策略

- 拉取和依赖更新前先检查 `git status --short --branch`。
- 不用目录复制同步源码，不在历史 integration 与当前仓库同时改同一功能。
- build、打包、版本升级、提交、推送、tag 和发布仍需单独明确授权。

## 危险边界

- 禁止 reset、clean、checkout 覆盖和整树 ours/theirs。
- 保护文件、数据库与真实设备证据边界以 `AGENTS.md` 为准。
- 不因 macOS 路径存在就绕过分支角色门。
