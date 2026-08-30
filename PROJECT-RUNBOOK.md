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
- macOS 当前默认分支为 `main`，用于读取、代码开发、开发启动、拉取、上游同步合并和检查。
- `T8-penguin-canvas-dev-*` 仅在需要隔离时使用；release 命名路径和 detached HEAD 不得用于日常开发。
- 历史 integration 与 release 目录不是日常开发入口。

## 安装

```bash
npm install
npm --prefix backend install
```

## 开发启动入口

两个入口都可以在 canonical core 的 `main` 或其他已连接开发分支使用；启动前必须先执行：

```bash
npm run worktree:development
```

macOS 图形入口：

```bash
./start-dev.command
```

当前图形脚本本身未内置 worktree role 门，所以上述手动预检不可省略；release 命名路径或 detached HEAD 不得直接运行。

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

实际代码修改前，在 `main` 或其他已连接开发分支上运行：

```bash
npm run worktree:development
```

## 更新策略

- 拉取和依赖更新前先检查 `git status --short --branch`。
- 不用目录复制同步源码，不在历史 integration 与当前仓库同时改同一功能。
- build、打包、版本升级、tag 和发布仍需单独明确授权；每日上游同步在门禁通过后可自动提交并推送 `origin/main`。

### 跨平台同步

- macOS 开发使用 `npm run sync:platform`。该入口会设置本仓库 `lfs.skipSmudge=true`，跳过 Windows `ffmpeg.exe` / `ffprobe.exe` 的大文件 materialize，并验证本机可用的原生 `ffmpeg`。
- Windows 发布或打包工作树使用 `npm run sync:platform`，自动恢复完整 Git LFS materialize；不得在发布前设置 `GIT_LFS_SKIP_SMUDGE=1`。
- 不要在 macOS 开发树直接使用裸 `git pull` 拉取受保护 Windows LFS 运行时；源码提交仍会正常快进，Windows 发布资源由 GitHub Actions 和 Windows 工作树校验。

## 危险边界

- 禁止 reset、clean、checkout 覆盖和整树 ours/theirs。
- 保护文件、数据库与真实设备证据边界以 `AGENTS.md` 为准。
- 不因 macOS 路径存在就绕过分支角色门。
