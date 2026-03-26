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

const defaultConfigPath = resolve(homedir(), ".config", "supabase-mcp-guard", "config.json");
const defaultLogPath = resolve(homedir(), ".local", "state", "supabase-mcp-guard", "audit.log");
const defaultStatePath = resolve(
  homedir(),
  ".local",
  "state",
  "supabase-mcp-guard",
  "write_lock.json",
);
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
const writeSensitiveTools = new Set(
  Object.entries(supabaseMcpToolSchemas)
    .filter(([, schema]) => schema.annotations?.readOnlyHint === false)
    .map(([name]) => name),
);

function exitWithError(message) {
  console.error(`[supabase-mcp-guard] ${message}`);
  process.exit(1);
}

function resolveHomePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }
  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  return resolve(value);
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
    configPath: values.config ? resolveHomePath(values.config) : defaultConfigPath,
    version: values.version ?? false,
    selfTest: values["self-test"] ?? false,
    minutes: values.minutes == null ? undefined : Number(values.minutes),
    client: values.client ? String(values.client).trim().toLowerCase() : null,
    command: positionals[0] ?? null,
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

  const keychainService = String(parsed.keychainService ?? "").trim();
  const keychainAccount = String(parsed.keychainAccount ?? "").trim();
  if (!keychainService || !keychainAccount) {
    exitWithError("配置缺少 keychainService 或 keychainAccount");
  }

  let features;
  if (parsed.features == null) {
    features = undefined;
  } else if (Array.isArray(parsed.features)) {
    features = parsed.features.map((item) => String(item).trim()).filter(Boolean);
  } else {
    exitWithError("配置字段 features 必须是数组或 null");
  }

  if (features) {
    for (const feature of features) {
      if (!supportedFeatures.has(feature)) {
        exitWithError(`不支持的 features 值: ${feature}`);
      }
    }
  }

  const projectRef = parsed.projectRef == null ? undefined : String(parsed.projectRef).trim();
  const apiUrl = parsed.apiUrl == null ? undefined : String(parsed.apiUrl).trim();
  const logFile = parsed.logFile == null ? defaultLogPath : resolveHomePath(String(parsed.logFile));
  const stateFile =
    parsed.stateFile == null ? defaultStatePath : resolveHomePath(String(parsed.stateFile));
  const readOnly = Boolean(parsed.readOnly);
  const allowedProjectIds = Array.isArray(parsed.allowedProjectIds)
    ? parsed.allowedProjectIds.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const defaultUnlockMinutes =
    parsed.defaultUnlockMinutes == null ? 10 : Number(parsed.defaultUnlockMinutes);
  const alwaysBlockedTools = new Set(
    Array.isArray(parsed.alwaysBlockedTools) && parsed.alwaysBlockedTools.length > 0
      ? parsed.alwaysBlockedTools.map((item) => String(item).trim()).filter(Boolean)
      : [...defaultAlwaysBlockedTools],
  );

  if (!Number.isFinite(defaultUnlockMinutes) || defaultUnlockMinutes <= 0) {
    exitWithError("配置字段 defaultUnlockMinutes 必须是正数");
  }

  return {
    configPath,
    keychainService,
    keychainAccount,
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

function ensureMacosKeychain() {
  if (process.platform !== "darwin") {
    exitWithError("当前版本仅支持 macOS Keychain");
  }
}

function readTokenFromKeychain(service, account) {
  ensureMacosKeychain();
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", service, "-a", account],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    const detail = stderr || error.message;
    exitWithError(`从 macOS Keychain 读取 token 失败: ${detail}`);
  }
}

function appendAuditLog(logFile, payload) {
  const logDir = dirname(logFile);
  try {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
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
  if (!existsSync(config.stateFile)) {
    return;
  }
  unlinkSync(config.stateFile);
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
  const accessToken = readTokenFromKeychain(config.keychainService, config.keychainAccount);
  if (!accessToken) {
    exitWithError("Keychain 中的 token 为空");
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
      stateFile: defaultStatePath,
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
