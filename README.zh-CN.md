# supabase-mcp-guard

[English](./README.md) | 简体中文

[![CI](https://github.com/askmeishi/supabase-mcp-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/askmeishi/supabase-mcp-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

`supabase-mcp-guard` 是一个 Supabase MCP 的本地安全包装层。

它的目标不是替代官方 `@supabase/mcp-server-supabase`，而是在 MCP 请求到达官方服务之前，先增加一层本地策略控制：

- 不在配置文件或命令行里暴露 Supabase token
- 默认写保护
- 项目白名单
- 高危工具永久禁用
- 审计日志

## 适用场景

适合这类环境：

- 你在本机大量使用 AI 编程工具
- 你依赖 Supabase MCP 做查询、迁移、函数部署、SQL 调试
- 你不希望 access token 明文落在客户端配置里
- 你希望“生产写入”必须显式解锁，而不是默认就能写

## 当前支持

### 平台

- macOS
  - `macos-keychain`
  - `env`
  - `command`
  - `powershell-secretmanagement`
- Windows
  - `powershell-secretmanagement`
  - `windows-credential-manager`
  - `env`
  - `command`
- Linux
  - `env`
  - `command`
  - `powershell-secretmanagement`

### MCP 客户端

- Codex
- Claude Code
- Cursor
- VS Code

### 附带安装器

- macOS: [scripts/install_macos.sh](./scripts/install_macos.sh)
- Windows: [scripts/install_windows.ps1](./scripts/install_windows.ps1)

## 核心能力

- 从 secret provider 读取 Supabase access token
- 避免通过命令行参数传递 token
- 支持 `allowedProjectIds` 白名单
- 对部分高危工具做永久 denylist
- 默认开启写锁
- 通过 `unlock --minutes` 短时放开写操作
- 对 `execute_sql` 区分只读 SQL 和写/DDL SQL
- 写入本地审计日志
- 支持中英文 CLI 提示

## 安装

### 克隆仓库

```bash
git clone https://github.com/askmeishi/supabase-mcp-guard.git
cd supabase-mcp-guard
```

### 安装依赖

```bash
npm install
```

### 通过 npm 全局安装

```bash
npm install -g supabase-mcp-guard
```

如果你走 npm 全局安装，就不需要先克隆仓库，也可以直接运行：

```bash
supabase-mcp-guard --self-test
```

### macOS

```bash
./scripts/install_macos.sh --client=codex
```

脚本会：

- 提示你输入新的 Supabase Access Token
- 把 token 写入 macOS Keychain
- 写配置到 `~/.config/supabase-mcp-guard/config.json`
- 安装 wrapper 到 `/usr/local/bin/supabase-mcp-guard`
- 可选自动改写 `~/.codex/config.toml`

### Windows

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install_windows.ps1
```

脚本会：

- 提示你输入新的 Supabase Access Token
- 安装 `SecretManagement` / `SecretStore` 模块（若缺失）
- 把 token 写入 `SecretStore`
- 写配置到 `%APPDATA%\supabase-mcp-guard\config.json`
- 安装 wrapper 到 `%LOCALAPPDATA%\Programs\supabase-mcp-guard`

如果不是通过仓库脚本安装，而是通过 npm 全局安装，也可以直接使用二进制，并基于 [config.example.json](./config.example.json) 手工生成配置。

## Secret Provider 示例

### macOS Keychain

```json
{
  "secretProvider": {
    "type": "macos-keychain",
    "service": "supabase-mcp-guard",
    "account": "primary"
  }
}
```

### PowerShell SecretManagement

```json
{
  "secretProvider": {
    "type": "powershell-secretmanagement",
    "name": "supabase-mcp-guard",
    "vault": "SecretStore"
  }
}
```

### Windows Credential Manager

```json
{
  "secretProvider": {
    "type": "windows-credential-manager",
    "target": "supabase-mcp-guard"
  }
}
```

### 环境变量

```json
{
  "secretProvider": {
    "type": "env",
    "name": "SUPABASE_ACCESS_TOKEN"
  }
}
```

### 外部命令

```json
{
  "secretProvider": {
    "type": "command",
    "command": "op",
    "args": ["read", "op://vault/item/token"]
  }
}
```

## 配置

示例配置文件见 [config.example.json](./config.example.json)。

常见配置：

```json
{
  "secretProvider": {
    "type": "macos-keychain",
    "service": "supabase-mcp-guard",
    "account": "primary"
  },
  "projectRef": null,
  "readOnly": false,
  "features": null,
  "apiUrl": null,
  "logFile": "~/.local/state/supabase-mcp-guard/audit.log",
  "stateFile": "~/.local/state/supabase-mcp-guard/write_lock.json",
  "defaultUnlockMinutes": 10,
  "allowedProjectIds": ["your-project-ref"],
  "alwaysBlockedTools": ["create_project", "pause_project", "restore_project"]
}
```

## 客户端配置片段

CLI 可以直接输出配置片段：

```bash
supabase-mcp-guard print-snippet --client codex
supabase-mcp-guard print-snippet --client claude-code
supabase-mcp-guard print-snippet --client cursor
supabase-mcp-guard print-snippet --client vscode
```

### Codex

```toml
[mcp_servers.supabase]
command = "supabase-mcp-guard"
startup_timeout_sec = 30
```

### Claude Code / Cursor

```json
{
  "mcpServers": {
    "supabase": {
      "type": "stdio",
      "command": "supabase-mcp-guard",
      "args": []
    }
  }
}
```

### VS Code

```json
{
  "servers": {
    "supabase": {
      "type": "stdio",
      "command": "supabase-mcp-guard",
      "args": []
    }
  }
}
```

## 使用

启动 stdio MCP server：

```bash
supabase-mcp-guard
```

查看锁状态：

```bash
supabase-mcp-guard status
```

临时解锁写操作：

```bash
supabase-mcp-guard unlock --minutes 10
```

重新上锁：

```bash
supabase-mcp-guard lock
```

自检：

```bash
supabase-mcp-guard --self-test
```

## 中英文切换

CLI 会根据以下顺序决定语言：

1. `SUPABASE_MCP_GUARD_LANG`
2. `LANG`
3. 默认英文

例如：

```bash
SUPABASE_MCP_GUARD_LANG=zh-CN supabase-mcp-guard status
SUPABASE_MCP_GUARD_LANG=en supabase-mcp-guard status
```

## 安全边界

这个工具能降低“本机 AI Agent 滥用 MCP”的风险，但不能替代数据库自身的安全设计。你仍然需要：

- 正确配置 schema/grants
- 对需要暴露的表启用 RLS
- 控制 `SECURITY DEFINER`
- 固定 `search_path`

更完整的安全说明见：

- [SECURITY.md](./SECURITY.md)
- [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)

## 发布

仓库已经补齐本地校验和 tag 发版链路。

本地发版前校验：

```bash
npm run check
npm pack --dry-run
```

推荐发版流程：

1. 修改 `package.json` 版本号
2. 提交并推送到 `main`
3. 创建并推送版本 tag，例如 `v0.1.1`
4. GitHub Actions `Release` 自动发布到 npm，并创建 GitHub Release

仓库需要预先配置：

- GitHub Actions Secret：`NPM_TOKEN`

## License

MIT
