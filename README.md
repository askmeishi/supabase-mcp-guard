# supabase-mcp-guard

[![CI](https://github.com/askmeishi/supabase-mcp-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/askmeishi/supabase-mcp-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Local policy wrapper for Supabase MCP.

It keeps your Supabase access token out of MCP config files and command-line arguments, stores the token in macOS Keychain, and adds local safety controls before requests reach the official `@supabase/mcp-server-supabase`.

This project does not replace Supabase MCP. It sits in front of it.

## Why this exists

Supabase MCP is powerful, but many AI coding clients treat MCP tools as highly trusted local capabilities. In practice that creates a few common problems:

- Supabase access tokens often end up in plain text client config.
- Tokens are frequently passed through command-line arguments.
- Production and development projects share one broad access token.
- Write-capable tools are available by default.
- AI agents can accidentally run migrations or write SQL against production.

`supabase-mcp-guard` reduces that risk locally with a stricter execution model.

## What it does

- Reads the Supabase access token from macOS Keychain instead of config files.
- Keeps the token out of command-line arguments.
- Supports project allowlists.
- Blocks selected high-risk tools permanently.
- Keeps write protection enabled by default.
- Allows short unlock windows for write operations.
- Treats `execute_sql` specially: read-only SQL can pass while write/DDL SQL is blocked unless unlocked.
- Writes a local audit log for tool calls and blocked operations.

## Scope

Current version scope:

- Supported OS: macOS
- Secret backend: macOS Keychain
- Transport: stdio MCP
- Target upstream server: `@supabase/mcp-server-supabase`

This is intentionally narrow for the first public version.

## Install

### 1. Clone the repo

```bash
git clone https://github.com/askmeishi/supabase-mcp-guard.git
cd supabase-mcp-guard
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the macOS installer

```bash
./scripts/install_macos.sh --client=codex
```

The installer will:

- ask for a new Supabase access token
- store it in macOS Keychain
- write local config to `~/.config/supabase-mcp-guard/config.json`
- install the wrapper to `/usr/local/bin/supabase-mcp-guard`
- optionally patch `~/.codex/config.toml`

If you do not want automatic Codex config changes:

```bash
./scripts/install_macos.sh
```

## Codex config example

You can print the config snippet at any time:

```bash
supabase-mcp-guard print-snippet --client codex
```

Current output:

```toml
[mcp_servers.supabase]
command = "supabase-mcp-guard"
startup_timeout_sec = 30
```

## Config

Example config: [config.example.json](./config.example.json)

Typical config:

```json
{
  "keychainService": "supabase-mcp-guard",
  "keychainAccount": "primary",
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

The wrapper writes a local audit log to:

```text
~/.local/state/supabase-mcp-guard/audit.log
```

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

## Roadmap

- Linux secret backend support
- Windows credential backend support
- finer-grained SQL policy rules
- environment-specific policies
- notification hooks for blocked high-risk actions

## License

MIT
