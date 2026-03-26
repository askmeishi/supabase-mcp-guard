# supabase-mcp-guard

English | [简体中文](./README.zh-CN.md)

[![CI](https://github.com/askmeishi/supabase-mcp-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/askmeishi/supabase-mcp-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Local policy wrapper for Supabase MCP.

It keeps your Supabase access token out of MCP config files and command-line arguments, adds local policy checks before requests hit the official `@supabase/mcp-server-supabase`, and makes production write access an explicit action instead of a default capability.

This project does not replace Supabase MCP. It sits in front of it.

## Why this exists

Supabase MCP is powerful, but AI coding clients usually treat MCP servers as highly trusted local tools. In practice that creates a few common problems:

- Supabase access tokens end up in plain text config files.
- Tokens are passed through command-line arguments.
- Production and development projects share one broad access token.
- Write-capable tools are available by default.
- AI agents can accidentally run migrations or write SQL against production.

`supabase-mcp-guard` reduces that risk locally with a stricter execution model.

## What it does

- Reads the Supabase access token from a configurable secret provider.
- Keeps the token out of command-line arguments.
- Supports project allowlists.
- Blocks selected high-risk tools permanently.
- Keeps write protection enabled by default.
- Allows short unlock windows for write operations.
- Treats `execute_sql` specially: read-only SQL can pass while write/DDL SQL is blocked unless unlocked.
- Writes a local audit log for tool calls and blocked operations.

## Current platform support

- macOS
  - `macos-keychain`
  - `env`
  - `command`
  - `powershell-secretmanagement` if you already use PowerShell on macOS
- Windows
  - `powershell-secretmanagement`
  - `windows-credential-manager`
  - `env`
  - `command`
- Linux
  - `env`
  - `command`
  - `powershell-secretmanagement` if PowerShell is installed

The first-class installers included in this repo are:

- macOS: [scripts/install_macos.sh](./scripts/install_macos.sh)
- Windows: [scripts/install_windows.ps1](./scripts/install_windows.ps1)

## Supported MCP clients

This project uses stdio transport, so it can be wired into many MCP-capable clients.

Documented in this repo:

- Codex
- Claude Code
- Cursor
- VS Code

## Install

### Clone the repo

```bash
git clone https://github.com/askmeishi/supabase-mcp-guard.git
cd supabase-mcp-guard
```

### Install dependencies

```bash
npm install
```

### Install from npm

```bash
npm install -g supabase-mcp-guard
```

If you install from npm globally, you can run the wrapper directly without cloning the repo:

```bash
supabase-mcp-guard --self-test
```

### macOS installer

```bash
./scripts/install_macos.sh --client=codex
```

What it does:

- prompts for a new Supabase access token
- stores it in macOS Keychain
- writes config to `~/.config/supabase-mcp-guard/config.json`
- installs the wrapper to `/usr/local/bin/supabase-mcp-guard`
- optionally patches `~/.codex/config.toml`

### Windows installer

Open PowerShell and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install_windows.ps1
```

What it does:

- prompts for a new Supabase access token
- installs PowerShell `SecretManagement` and `SecretStore` modules if missing
- stores the token in `SecretStore`
- writes config to `%APPDATA%\supabase-mcp-guard\config.json`
- installs the wrapper under `%LOCALAPPDATA%\Programs\supabase-mcp-guard`
- adds the local wrapper directory to the user `PATH`

If you installed from npm instead of cloning this repo, you can still use the wrapper directly and create your config manually from [config.example.json](./config.example.json).

## Secret providers

### `macos-keychain`

Use macOS Keychain:

```json
{
  "secretProvider": {
    "type": "macos-keychain",
    "service": "supabase-mcp-guard",
    "account": "primary"
  }
}
```

### `powershell-secretmanagement`

Use PowerShell SecretManagement and a named secret:

```json
{
  "secretProvider": {
    "type": "powershell-secretmanagement",
    "name": "supabase-mcp-guard",
    "vault": "SecretStore"
  }
}
```

### `windows-credential-manager`

Use a Windows Credential Manager target:

```json
{
  "secretProvider": {
    "type": "windows-credential-manager",
    "target": "supabase-mcp-guard"
  }
}
```

This provider expects a PowerShell environment where the `CredentialManager` module and `Get-StoredCredential` are available.

### `env`

Read the token from an environment variable:

```json
{
  "secretProvider": {
    "type": "env",
    "name": "SUPABASE_ACCESS_TOKEN"
  }
}
```

### `command`

Read the token from an arbitrary local command:

```json
{
  "secretProvider": {
    "type": "command",
    "command": "op",
    "args": ["read", "op://vault/item/token"]
  }
}
```

This is the most flexible option for unsupported platforms or custom secret stores.

## Config

Example config: [config.example.json](./config.example.json)

Typical config:

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

Notes:

- `allowedProjectIds`: if set, requests for other project IDs are blocked.
- `projectRef`: optional upstream fixed project binding.
- `readOnly`: if true, all write-sensitive upstream tools are blocked even during unlock windows.
- `alwaysBlockedTools`: tools that are always denied.

## Client snippets

The CLI can print snippets directly:

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

### Claude Code

Use a stdio MCP server entry in your Claude Code MCP JSON:

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

### Cursor

Use a stdio MCP server entry in your Cursor MCP JSON:

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

Use a stdio MCP server entry in your VS Code MCP config:

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

## Usage

Start as MCP stdio server:

```bash
supabase-mcp-guard
```

Check current lock state:

```bash
supabase-mcp-guard status
```

Temporarily unlock writes:

```bash
supabase-mcp-guard unlock --minutes 10
```

Lock again:

```bash
supabase-mcp-guard lock
```

Self-test:

```bash
supabase-mcp-guard --self-test
```

## Security model

The guard enforces a local policy layer before forwarding requests upstream:

- `execute_sql`
  - read-only SQL is allowed
  - write/DDL SQL is blocked unless unlocked
- tools marked by upstream as write-capable
  - blocked unless unlocked
- tools in `alwaysBlockedTools`
  - always blocked
- project IDs outside `allowedProjectIds`
  - always blocked

This helps reduce accidental misuse, but it is not a substitute for correct database-side security:

- do not expose sensitive schemas
- use proper grants
- use RLS where appropriate
- keep `SECURITY DEFINER` and `search_path` under control

## Audit log

The wrapper writes a local audit log to the configured `logFile`.

Examples:

- macOS/Linux default: `~/.local/state/supabase-mcp-guard/audit.log`
- Windows default: `%LOCALAPPDATA%\supabase-mcp-guard\audit.log`

Blocked requests and completed upstream tool calls are both recorded.

## Threat model

This project is designed for the common local AI-assistant risk model:

- you trust your own machine
- you do not want secrets sitting in plaintext config
- you want a last-mile local policy check before production writes

It does not protect against:

- a fully compromised machine
- malicious code already running with your user privileges
- overbroad permissions granted directly inside Supabase

## Publishing

This repository is set up for both local package validation and tagged releases.

Local verification before release:

```bash
npm run check
npm pack --dry-run
```

Release flow:

1. bump `package.json` version
2. commit and push to `main`
3. create and push a version tag such as `v0.1.1`
4. GitHub Actions `Release` publishes to npm and creates a GitHub Release

Required secret:

- `NPM_TOKEN` in the GitHub repository secrets

## Roadmap

- Linux first-class installer
- client-specific helper commands beyond config snippets
- finer-grained SQL policy rules
- environment-specific policies
- notification hooks for blocked high-risk actions

## References

For the latest client-specific MCP setup details, check the official client docs:

- [Cursor MCP docs](https://docs.cursor.com/advanced/model-context-protocol)
- [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [VS Code MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)

The JSON snippets above are intended for stdio-based MCP clients and may need minor path adjustments depending on how you install the wrapper.

## License

MIT
