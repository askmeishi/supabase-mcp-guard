#!/usr/bin/env node

import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createSupabaseMcpServer,
  supabaseMcpToolSchemas,
  version as supabaseMcpVersion,
} from "@supabase/mcp-server-supabase";
import { createSupabaseApiPlatform } from "@supabase/mcp-server-supabase/platform/api";

const supportedFeatures = new Set([
  "account",
  "branching",
  "database",
  "debugging",
  "development",
  "docs",
  "functions",
  "storage",
]);
const defaultAlwaysBlockedTools = new Set(["create_project", "pause_project", "restore_project"]);
const secretProviderTypes = new Set([
  "macos-keychain",
  "windows-credential-manager",
  "powershell-secretmanagement",
  "env",
  "command",
]);
const writeSensitiveTools = new Set(
  Object.entries(supabaseMcpToolSchemas)
    .filter(([, schema]) => schema.annotations?.readOnlyHint === false)
    .map(([name]) => name),
);

function getDefaultPaths() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || resolve(homedir(), "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || resolve(homedir(), "AppData", "Local");
    return {
      configPath: resolve(appData, "supabase-mcp-guard", "config.json"),
      logPath: resolve(localAppData, "supabase-mcp-guard", "audit.log"),
      statePath: resolve(localAppData, "supabase-mcp-guard", "write_lock.json"),
    };
  }

  return {
    configPath: resolve(homedir(), ".config", "supabase-mcp-guard", "config.json"),
    logPath: resolve(homedir(), ".local", "state", "supabase-mcp-guard", "audit.log"),
    statePath: resolve(homedir(), ".local", "state", "supabase-mcp-guard", "write_lock.json"),
  };
}

const defaultPaths = getDefaultPaths();

function exitWithError(message) {
  console.error(`[supabase-mcp-guard] ${message}`);
  process.exit(1);
}

function resolveTemplatePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }

  let expanded = value;
  if (expanded.startsWith("~/")) {
    expanded = resolve(homedir(), expanded.slice(2));
  }

  expanded = expanded.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
  expanded = expanded.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? "");

  return resolve(expanded);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: "string" },
      version: { type: "boolean", short: "v" },
      "self-test": { type: "boolean" },
      minutes: { type: "string" },
      client: { type: "string" },
    },
    allowPositionals: true,
  });

  return {
    configPath: values.config ? resolveTemplatePath(values.config) : defaultPaths.configPath,
    version: values.version ?? false,
    selfTest: values["self-test"] ?? false,
    minutes: values.minutes == null ? undefined : Number(values.minutes),
    client: values.client ? String(values.client).trim().toLowerCase() : null,
    command: positionals[0] ?? null,
  };
}

function buildLegacySecretProvider(parsed) {
  const keychainService = String(parsed.keychainService ?? "").trim();
  const keychainAccount = String(parsed.keychainAccount ?? "").trim();
  if (!keychainService || !keychainAccount) {
    exitWithError("配置缺少 secretProvider，且旧字段 keychainService/keychainAccount 也不完整");
  }

  return {
    type: "macos-keychain",
    service: keychainService,
    account: keychainAccount,
  };
}

function normalizeSecretProvider(parsed) {
  if (!parsed.secretProvider) {
    return buildLegacySecretProvider(parsed);
  }

  if (typeof parsed.secretProvider !== "object" || parsed.secretProvider === null) {
    exitWithError("配置字段 secretProvider 必须是对象");
  }

  const provider = parsed.secretProvider;
  const type = String(provider.type ?? "").trim();
  if (!secretProviderTypes.has(type)) {
    exitWithError(`不支持的 secretProvider.type: ${type}`);
  }

  if (type === "macos-keychain") {
    const service = String(provider.service ?? "").trim();
    const account = String(provider.account ?? "").trim();
    if (!service || !account) {
      exitWithError("macos-keychain provider 需要 service 和 account");
    }
    return { type, service, account };
  }

  if (type === "windows-credential-manager") {
    const target = String(provider.target ?? "").trim();
    if (!target) {
      exitWithError("windows-credential-manager provider 需要 target");
    }
    return { type, target };
  }

  if (type === "powershell-secretmanagement") {
    const name = String(provider.name ?? "").trim();
    const vault = provider.vault == null ? undefined : String(provider.vault).trim();
    if (!name) {
      exitWithError("powershell-secretmanagement provider 需要 name");
    }
    return { type, name, vault: vault || undefined };
  }

  if (type === "env") {
    const name = String(provider.name ?? "").trim();
    if (!name) {
      exitWithError("env provider 需要 name");
    }
    return { type, name };
  }

  const command = String(provider.command ?? "").trim();
  if (!command) {
    exitWithError("command provider 需要 command");
  }
  return {
    type,
    command,
    args: normalizeStringList(provider.args),
    env: provider.env && typeof provider.env === "object" ? provider.env : undefined,
  };
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    exitWithError(`配置文件不存在: ${configPath}`);
  }

  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    exitWithError(`读取配置失败: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    exitWithError(`配置文件不是合法 JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    exitWithError("配置文件内容无效");
  }

  const features = parsed.features == null ? undefined : normalizeStringList(parsed.features);
  if (features) {
    for (const feature of features) {
      if (!supportedFeatures.has(feature)) {
        exitWithError(`不支持的 features 值: ${feature}`);
      }
    }
  }

  const projectRef = parsed.projectRef == null ? undefined : String(parsed.projectRef).trim();
  const apiUrl = parsed.apiUrl == null ? undefined : String(parsed.apiUrl).trim();
  const logFile =
    parsed.logFile == null ? defaultPaths.logPath : resolveTemplatePath(String(parsed.logFile));
  const stateFile =
    parsed.stateFile == null ? defaultPaths.statePath : resolveTemplatePath(String(parsed.stateFile));
  const readOnly = Boolean(parsed.readOnly);
  const allowedProjectIds = normalizeStringList(parsed.allowedProjectIds);
  const defaultUnlockMinutes =
    parsed.defaultUnlockMinutes == null ? 10 : Number(parsed.defaultUnlockMinutes);
  const alwaysBlockedTools = new Set(
    parsed.alwaysBlockedTools == null || normalizeStringList(parsed.alwaysBlockedTools).length === 0
      ? [...defaultAlwaysBlockedTools]
      : normalizeStringList(parsed.alwaysBlockedTools),
  );

  if (!Number.isFinite(defaultUnlockMinutes) || defaultUnlockMinutes <= 0) {
    exitWithError("配置字段 defaultUnlockMinutes 必须是正数");
  }

  return {
    configPath,
    secretProvider: normalizeSecretProvider(parsed),
    projectRef: projectRef || undefined,
    apiUrl: apiUrl || undefined,
    readOnly,
    features,
    logFile,
    stateFile,
    allowedProjectIds,
    defaultUnlockMinutes,
    alwaysBlockedTools,
  };
}

function ensurePlatform(expectedPlatform, providerName) {
  if (process.platform !== expectedPlatform) {
    exitWithError(`${providerName} 仅支持 ${expectedPlatform}`);
  }
}

function readTokenViaMacosKeychain(provider) {
  ensurePlatform("darwin", "macos-keychain");
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", provider.service, "-a", provider.account],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    exitWithError(`从 macOS Keychain 读取 token 失败: ${stderr || error.message}`);
  }
}

function readTokenViaWindowsCredentialManager(provider) {
  ensurePlatform("win32", "windows-credential-manager");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module CredentialManager -ErrorAction Stop",
    `$entry = Get-StoredCredential -Target '${provider.target.replace(/'/g, "''")}'`,
    "if ($null -eq $entry) { throw 'credential not found' }",
    "if ($entry -is [pscredential]) {",
    "  [Console]::Out.Write($entry.GetNetworkCredential().Password)",
    "} elseif ($entry.Password) {",
    "  [Console]::Out.Write($entry.Password)",
    "} elseif ($entry.GetNetworkCredential) {",
    "  [Console]::Out.Write($entry.GetNetworkCredential().Password)",
    "} else {",
    "  throw 'password not accessible'",
    "}",
  ].join("; ");

  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    exitWithError(
      `从 Windows Credential Manager 读取 token 失败: ${stderr || error.message}`,
    );
  }
}

function readTokenViaPowerShellSecretManagement(provider) {
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const vaultExpr = provider.vault
    ? ` -Vault '${provider.vault.replace(/'/g, "''")}'`
    : "";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop",
    `[Console]::Out.Write((Get-Secret -Name '${provider.name.replace(/'/g, "''")}'${vaultExpr} -AsPlainText))`,
  ].join("; ");

  try {
    return execFileSync(
      shell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    exitWithError(
      `通过 PowerShell SecretManagement 读取 token 失败: ${stderr || error.message}`,
    );
  }
}

function readTokenViaEnv(provider) {
  const value = process.env[provider.name];
  if (!value) {
    exitWithError(`环境变量 ${provider.name} 未设置或为空`);
  }
  return String(value).trim();
}

function readTokenViaCommand(provider) {
  const env = { ...process.env };
  if (provider.env) {
    for (const [key, value] of Object.entries(provider.env)) {
      env[key] = String(value);
    }
  }

  try {
    return execFileSync(provider.command, provider.args ?? [], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    }).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    exitWithError(`通过命令读取 token 失败: ${stderr || error.message}`);
  }
}

function readTokenFromProvider(provider) {
  if (provider.type === "macos-keychain") {
    return readTokenViaMacosKeychain(provider);
  }
  if (provider.type === "windows-credential-manager") {
    return readTokenViaWindowsCredentialManager(provider);
  }
  if (provider.type === "powershell-secretmanagement") {
    return readTokenViaPowerShellSecretManagement(provider);
  }
  if (provider.type === "env") {
    return readTokenViaEnv(provider);
  }
  if (provider.type === "command") {
    return readTokenViaCommand(provider);
  }

  exitWithError(`未知 secret provider: ${provider.type}`);
}

function appendAuditLog(logFile, payload) {
  try {
    mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(logFile, 0o600);
  } catch (error) {
    console.error(`[supabase-mcp-guard] 写入审计日志失败: ${error.message}`);
  }
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
}

function buildArgumentDigest(argumentsObject) {
  if (!argumentsObject || typeof argumentsObject !== "object") {
    return { size: 0 };
  }

  const entries = Object.entries(argumentsObject).map(([key, value]) => {
    let type = typeof value;
    if (Array.isArray(value)) {
      type = "array";
    } else if (value === null) {
      type = "null";
    }

    let length = 0;
    try {
      length = JSON.stringify(value)?.length ?? 0;
    } catch {
      length = 0;
    }

    return { key, type, length };
  });

  return {
    size: entries.length,
    entries,
  };
}

function createAuditLogger(config) {
  return (details) => {
    appendAuditLog(config.logFile, {
      ts: new Date().toISOString(),
      tool: details.name,
      success: details.success,
      argument_digest: buildArgumentDigest(details.arguments),
      error: details.success ? undefined : String(details.error ?? "unknown"),
    });
  };
}

function classifySql(query) {
  if (typeof query !== "string") {
    return { type: "unknown", reason: "query 不是字符串" };
  }

  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
  if (!stripped) {
    return { type: "unknown", reason: "query 为空" };
  }

  const normalized = stripped.toLowerCase();
  const writeKeyword =
    /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|merge|call|do|copy|vacuum|reindex|comment|refresh|analyze)\b/;
  if (writeKeyword.test(normalized)) {
    return { type: "write", reason: "检测到写或 DDL 关键字" };
  }

  if (/^\s*(select|explain|show|values)\b/.test(normalized)) {
    return { type: "read", reason: "只读语句" };
  }

  if (/^\s*with\b/.test(normalized)) {
    return { type: "unknown", reason: "WITH 语句无法安全判定" };
  }

  return { type: "unknown", reason: "无法判定 SQL 类型" };
}

function readUnlockState(config) {
  if (!existsSync(config.stateFile)) {
    return { unlocked: false, until: null };
  }

  try {
    const raw = readFileSync(config.stateFile, "utf8");
    const data = JSON.parse(raw);
    const until = typeof data.unlockedUntil === "string" ? Date.parse(data.unlockedUntil) : NaN;
    if (!Number.isFinite(until) || until <= Date.now()) {
      return { unlocked: false, until: null };
    }
    return { unlocked: true, until: new Date(until).toISOString() };
  } catch {
    return { unlocked: false, until: null };
  }
}

function writeUnlockState(config, minutes) {
  ensureParentDir(config.stateFile);
  const unlockedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  writeFileSync(
    config.stateFile,
    JSON.stringify({ unlockedUntil, updatedAt: new Date().toISOString() }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(config.stateFile, 0o600);
  return unlockedUntil;
}

function clearUnlockState(config) {
  if (existsSync(config.stateFile)) {
    unlinkSync(config.stateFile);
  }
}

function buildJsonRpcError(id, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
    },
  };
}

function guardToolCall(config, message) {
  if (!message || message.method !== "tools/call" || message.id == null) {
    return null;
  }

  const toolName = String(message.params?.name ?? "").trim();
  const argumentsObject =
    message.params && typeof message.params.arguments === "object" && message.params.arguments
      ? message.params.arguments
      : {};

  if (!toolName) {
    return null;
  }

  if (config.alwaysBlockedTools.has(toolName)) {
    return `工具 ${toolName} 已被本地安全策略永久禁用`;
  }

  const projectId =
    typeof argumentsObject.project_id === "string" ? argumentsObject.project_id.trim() : "";
  if (
    projectId &&
    config.allowedProjectIds.length > 0 &&
    !config.allowedProjectIds.includes(projectId)
  ) {
    return `project_id=${projectId} 不在本地白名单中`;
  }

  if (toolName === "execute_sql") {
    if (config.readOnly) {
      return "execute_sql 被 readOnly 配置阻止";
    }
    const sqlState = classifySql(argumentsObject.query);
    if (sqlState.type === "read") {
      return null;
    }
    const unlockState = readUnlockState(config);
    if (!unlockState.unlocked) {
      return `execute_sql 当前仅允许只读 SQL；如需执行写 SQL，请先运行 supabase-mcp-guard unlock --minutes ${config.defaultUnlockMinutes}`;
    }
    return null;
  }

  if (!writeSensitiveTools.has(toolName)) {
    return null;
  }

  if (config.readOnly) {
    return `工具 ${toolName} 被 readOnly 配置阻止`;
  }

  const unlockState = readUnlockState(config);
  if (unlockState.unlocked) {
    return null;
  }

  return `工具 ${toolName} 当前处于写保护状态；如需执行，请先运行 supabase-mcp-guard unlock --minutes ${config.defaultUnlockMinutes}`;
}

class GuardedStdioTransport {
  constructor(config) {
    this.config = config;
    this.inner = new StdioServerTransport();
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (error) => this.onerror?.(error);
  }

  async start() {
    this.inner.onmessage = async (message, extra) => {
      const blockedReason = guardToolCall(this.config, message);
      if (!blockedReason) {
        this.onmessage?.(message, extra);
        return;
      }

      appendAuditLog(this.config.logFile, {
        ts: new Date().toISOString(),
        blocked: true,
        reason: blockedReason,
        tool: message?.params?.name ?? null,
        argument_digest: buildArgumentDigest(message?.params?.arguments),
      });

      await this.inner.send(buildJsonRpcError(message.id, blockedReason));
    };
    await this.inner.start();
  }

  async send(message, options) {
    return this.inner.send(message, options);
  }

  async close() {
    return this.inner.close();
  }
}

async function buildServer(config) {
  const accessToken = readTokenFromProvider(config.secretProvider);
  if (!accessToken) {
    exitWithError("读取到的 token 为空");
  }

  const platform = createSupabaseApiPlatform({
    accessToken,
    apiUrl: config.apiUrl,
  });

  return createSupabaseMcpServer({
    platform,
    projectId: config.projectRef,
    readOnly: config.readOnly,
    features: config.features,
    onToolCall: createAuditLogger(config),
  });
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function printClientSnippet(client) {
  if (client === "codex") {
    console.log(`[mcp_servers.supabase]\ncommand = "supabase-mcp-guard"\nstartup_timeout_sec = 30`);
    return;
  }

  if (client === "cursor" || client === "claude-code") {
    printJson({
      mcpServers: {
        supabase: {
          type: "stdio",
          command: "supabase-mcp-guard",
          args: [],
        },
      },
    });
    return;
  }

  if (client === "vscode" || client === "vs-code" || client === "visual-studio-code") {
    printJson({
      servers: {
        supabase: {
          type: "stdio",
          command: "supabase-mcp-guard",
          args: [],
        },
      },
    });
    return;
  }

  exitWithError(`不支持的 client: ${client}`);
}

function handleControlCommand(args, config) {
  if (args.command === "print-snippet") {
    if (!args.client) {
      exitWithError("print-snippet 需要 --client 参数");
    }
    printClientSnippet(args.client);
    return true;
  }

  if (args.command === "status") {
    const unlockState = readUnlockState(config);
    printJson({
      unlocked: unlockState.unlocked,
      unlocked_until: unlockState.until,
      allowed_project_ids: config.allowedProjectIds,
      default_unlock_minutes: config.defaultUnlockMinutes,
      always_blocked_tools: [...config.alwaysBlockedTools],
      secret_provider_type: config.secretProvider.type,
    });
    return true;
  }

  if (args.command === "unlock") {
    const minutes = args.minutes ?? config.defaultUnlockMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      exitWithError("--minutes 必须是正数");
    }
    const unlockedUntil = writeUnlockState(config, minutes);
    printJson({
      unlocked: true,
      unlocked_until: unlockedUntil,
      minutes,
    });
    return true;
  }

  if (args.command === "lock") {
    clearUnlockState(config);
    printJson({
      unlocked: false,
      unlocked_until: null,
    });
    return true;
  }

  return false;
}

async function main() {
  const args = parseCliArgs();
  if (args.version) {
    console.log(supabaseMcpVersion);
    return;
  }

  if (args.command === "print-snippet") {
    handleControlCommand(args, {
      alwaysBlockedTools: defaultAlwaysBlockedTools,
      allowedProjectIds: [],
      defaultUnlockMinutes: 10,
      secretProvider: { type: "none" },
      stateFile: defaultPaths.statePath,
    });
    return;
  }

  const config = loadConfig(args.configPath);
  if (handleControlCommand(args, config)) {
    return;
  }

  const server = await buildServer(config);

  if (args.selfTest) {
    printJson({
      ok: true,
      config_path: config.configPath,
      project_ref: config.projectRef ?? null,
      read_only: config.readOnly,
      features: config.features ?? null,
      version: supabaseMcpVersion,
      allowed_project_ids: config.allowedProjectIds,
      write_lock_state: readUnlockState(config),
      default_unlock_minutes: config.defaultUnlockMinutes,
      always_blocked_tools: [...config.alwaysBlockedTools],
      secret_provider_type: config.secretProvider.type,
    });
    await server.close();
    return;
  }

  const transport = new GuardedStdioTransport(config);
  await server.connect(transport);
}

main().catch((error) => {
  exitWithError(error instanceof Error ? error.message : String(error));
});
