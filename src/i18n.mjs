const messages = {
  en: {
    missingCommand: "Missing command: {cmd}",
    fileNotFound: "Config file not found: {path}",
    configReadFailed: "Failed to read config: {message}",
    configJsonInvalid: "Config file is not valid JSON: {message}",
    configInvalid: "Config content is invalid",
    legacySecretMissing:
      "Config is missing secretProvider, and legacy keychainService/keychainAccount fields are also incomplete",
    secretProviderMustBeObject: "Config field secretProvider must be an object",
    secretProviderUnsupported: "Unsupported secretProvider.type: {type}",
    secretProviderMacosMissing: "macos-keychain provider requires service and account",
    secretProviderWindowsMissing: "windows-credential-manager provider requires target",
    secretProviderPsMissing: "powershell-secretmanagement provider requires name",
    secretProviderEnvMissing: "env provider requires name",
    secretProviderCommandMissing: "command provider requires command",
    featureUnsupported: "Unsupported feature value: {feature}",
    unlockMinutesInvalid: "Config field defaultUnlockMinutes must be a positive number",
    platformOnly: "{provider} is only supported on {platform}",
    macosReadFailed: "Failed to read token from macOS Keychain: {message}",
    windowsReadFailed: "Failed to read token from Windows Credential Manager: {message}",
    powershellSecretFailed:
      "Failed to read token via PowerShell SecretManagement: {message}",
    envMissing: "Environment variable {name} is missing or empty",
    commandReadFailed: "Failed to read token via command: {message}",
    unknownSecretProvider: "Unknown secret provider: {type}",
    auditWriteFailed: "Failed to write audit log: {message}",
    queryNotString: "query is not a string",
    queryEmpty: "query is empty",
    sqlWriteDetected: "write or DDL keyword detected",
    sqlReadOnly: "read-only SQL statement",
    sqlWithUnknown: "WITH statement cannot be safely classified",
    sqlUnknown: "unable to classify SQL",
    toolPermanentlyBlocked: "Tool {tool} is permanently blocked by local policy",
    projectBlocked: "project_id={projectId} is not in the local allowlist",
    executeSqlReadOnlyBlocked: "execute_sql is blocked by readOnly config",
    executeSqlUnlockRequired:
      "execute_sql currently allows read-only SQL only; run supabase-mcp-guard unlock --minutes {minutes} before write SQL",
    toolReadOnlyBlocked: "Tool {tool} is blocked by readOnly config",
    toolUnlockRequired:
      "Tool {tool} is currently write-locked; run supabase-mcp-guard unlock --minutes {minutes} first",
    tokenEmpty: "Resolved token is empty",
    clientUnsupported: "Unsupported client: {client}",
    printSnippetClientRequired: "print-snippet requires --client",
    minutesPositiveRequired: "--minutes must be a positive number",
  },
  zh: {
    missingCommand: "缺少命令: {cmd}",
    fileNotFound: "配置文件不存在: {path}",
    configReadFailed: "读取配置失败: {message}",
    configJsonInvalid: "配置文件不是合法 JSON: {message}",
    configInvalid: "配置文件内容无效",
    legacySecretMissing:
      "配置缺少 secretProvider，且旧字段 keychainService/keychainAccount 也不完整",
    secretProviderMustBeObject: "配置字段 secretProvider 必须是对象",
    secretProviderUnsupported: "不支持的 secretProvider.type: {type}",
    secretProviderMacosMissing: "macos-keychain provider 需要 service 和 account",
    secretProviderWindowsMissing: "windows-credential-manager provider 需要 target",
    secretProviderPsMissing: "powershell-secretmanagement provider 需要 name",
    secretProviderEnvMissing: "env provider 需要 name",
    secretProviderCommandMissing: "command provider 需要 command",
    featureUnsupported: "不支持的 features 值: {feature}",
    unlockMinutesInvalid: "配置字段 defaultUnlockMinutes 必须是正数",
    platformOnly: "{provider} 仅支持 {platform}",
    macosReadFailed: "从 macOS Keychain 读取 token 失败: {message}",
    windowsReadFailed: "从 Windows Credential Manager 读取 token 失败: {message}",
    powershellSecretFailed: "通过 PowerShell SecretManagement 读取 token 失败: {message}",
    envMissing: "环境变量 {name} 未设置或为空",
    commandReadFailed: "通过命令读取 token 失败: {message}",
    unknownSecretProvider: "未知 secret provider: {type}",
    auditWriteFailed: "写入审计日志失败: {message}",
    queryNotString: "query 不是字符串",
    queryEmpty: "query 为空",
    sqlWriteDetected: "检测到写或 DDL 关键字",
    sqlReadOnly: "只读语句",
    sqlWithUnknown: "WITH 语句无法安全判定",
    sqlUnknown: "无法判定 SQL 类型",
    toolPermanentlyBlocked: "工具 {tool} 已被本地安全策略永久禁用",
    projectBlocked: "project_id={projectId} 不在本地白名单中",
    executeSqlReadOnlyBlocked: "execute_sql 被 readOnly 配置阻止",
    executeSqlUnlockRequired:
      "execute_sql 当前仅允许只读 SQL；如需执行写 SQL，请先运行 supabase-mcp-guard unlock --minutes {minutes}",
    toolReadOnlyBlocked: "工具 {tool} 被 readOnly 配置阻止",
    toolUnlockRequired:
      "工具 {tool} 当前处于写保护状态；如需执行，请先运行 supabase-mcp-guard unlock --minutes {minutes}",
    tokenEmpty: "读取到的 token 为空",
    clientUnsupported: "不支持的 client: {client}",
    printSnippetClientRequired: "print-snippet 需要 --client 参数",
    minutesPositiveRequired: "--minutes 必须是正数",
  },
};

function detectLocale() {
  const raw = process.env.SUPABASE_MCP_GUARD_LANG || process.env.LANG || "";
  const normalized = raw.toLowerCase();
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  return "en";
}

const locale = detectLocale();

export function t(key, vars = {}) {
  const catalog = messages[locale] || messages.en;
  const template = catalog[key] || messages.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

export function currentLocale() {
  return locale;
}
