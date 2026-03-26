# Security Policy

[简体中文](./SECURITY.zh-CN.md) | English

## Scope

`supabase-mcp-guard` is a local policy layer in front of the official Supabase MCP server.

It is designed to reduce local misuse risk by:

- keeping Supabase access tokens out of plaintext config files
- removing token exposure from command-line arguments
- enforcing local project allowlists
- requiring explicit unlock windows for write-capable operations
- writing local audit logs

## Threat model

This project is primarily designed for the following threat model:

- the user trusts their own machine
- the user wants to reduce accidental or overly permissive AI-agent use of Supabase MCP
- the user wants local friction before production writes

## What it helps with

- plaintext token leakage from local MCP config
- casual token leakage through process listings or shell history
- accidental writes to the wrong Supabase project
- accidental AI-triggered migrations or write SQL
- missing local visibility into MCP usage

## What it does not solve

- a fully compromised machine
- malware running under the same user account
- a leaked token already copied elsewhere
- overbroad permissions inside Supabase itself
- broken database grants, bad RLS, or unsafe `SECURITY DEFINER` usage

## Security assumptions

This tool assumes:

- the local machine is not already compromised
- the selected secret backend is trustworthy for the platform
- Supabase-side permissions are still designed correctly

If your Supabase token has broad access, this tool reduces accidental use, but it does not magically turn that token into a least-privilege token.

## Recommended deployment model

- use a dedicated access token for MCP use
- restrict access to only the Supabase projects you actually need
- keep `allowedProjectIds` non-empty
- keep write lock enabled by default
- keep dangerous tools in `alwaysBlockedTools`
- use separate wrappers or configs for development and production
- continue to harden your database itself

## Coordinated disclosure

If you find a security issue in this project, please avoid opening a public issue with exploit details first.

Preferred process:

1. Create a private security report through GitHub Security Advisories if available.
2. If private reporting is unavailable, contact the maintainer directly before public disclosure.

Please include:

- affected version
- platform
- reproduction steps
- expected impact
- any suggested remediation
