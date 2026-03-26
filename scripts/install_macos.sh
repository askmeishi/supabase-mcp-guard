#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_ROOT="/usr/local/lib/supabase-mcp-guard"
INSTALL_BIN="/usr/local/bin/supabase-mcp-guard"
CONFIG_DIR="${HOME}/.config/supabase-mcp-guard"
CONFIG_FILE="${CONFIG_DIR}/config.json"
LOG_FILE="${HOME}/.local/state/supabase-mcp-guard/audit.log"
STATE_FILE="${HOME}/.local/state/supabase-mcp-guard/write_lock.json"
KEYCHAIN_SERVICE="supabase-mcp-guard"
KEYCHAIN_ACCOUNT="primary"
CLIENT="${1:-}"
CODEX_CONFIG="${HOME}/.codex/config.toml"
BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)"

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "缺少命令: ${cmd}" >&2
    exit 1
  fi
}

require_cmd sudo
require_cmd node
require_cmd npm
require_cmd security
require_cmd python3

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "当前安装脚本仅支持 macOS" >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/package.json" || ! -f "${REPO_ROOT}/src/cli.mjs" ]]; then
  echo "仓库文件不完整，请在 supabase-mcp-guard 仓库目录内执行" >&2
  exit 1
fi

read -r -s -p "请输入新的 Supabase Access Token: " SUPABASE_TOKEN
echo
if [[ -z "${SUPABASE_TOKEN}" ]]; then
  echo "token 不能为空" >&2
  exit 1
fi
if [[ "${SUPABASE_TOKEN}" != sbp_* ]]; then
  echo "token 格式看起来不对，预期以 sbp_ 开头" >&2
  exit 1
fi

read -r -p "请输入允许访问的 project refs（逗号分隔，可留空）: " PROJECT_REFS

mkdir -p "${CONFIG_DIR}"
chmod 700 "${CONFIG_DIR}"
mkdir -p "$(dirname "${LOG_FILE}")"
mkdir -p "$(dirname "${STATE_FILE}")"

security add-generic-password \
  -U \
  -s "${KEYCHAIN_SERVICE}" \
  -a "${KEYCHAIN_ACCOUNT}" \
  -w "${SUPABASE_TOKEN}" \
  -T "/usr/bin/security" \
  >/dev/null
unset SUPABASE_TOKEN

python3 - "${CONFIG_FILE}" "${LOG_FILE}" "${STATE_FILE}" "${PROJECT_REFS}" <<'PY'
import json
import pathlib
import sys

config_file = pathlib.Path(sys.argv[1])
log_file = sys.argv[2]
state_file = sys.argv[3]
project_refs = [item.strip() for item in sys.argv[4].split(",") if item.strip()]

payload = {
    "keychainService": "supabase-mcp-guard",
    "keychainAccount": "primary",
    "projectRef": None,
    "readOnly": False,
    "features": None,
    "apiUrl": None,
    "logFile": log_file,
    "stateFile": state_file,
    "defaultUnlockMinutes": 10,
    "allowedProjectIds": project_refs,
    "alwaysBlockedTools": [
        "create_project",
        "pause_project",
        "restore_project"
    ]
}

config_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

TMP_INSTALL_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_INSTALL_DIR}"
}
trap cleanup EXIT

cp "${REPO_ROOT}/package.json" "${TMP_INSTALL_DIR}/package.json"
cp "${REPO_ROOT}/src/cli.mjs" "${TMP_INSTALL_DIR}/cli.mjs"

if [[ -f "${REPO_ROOT}/package-lock.json" ]]; then
  cp "${REPO_ROOT}/package-lock.json" "${TMP_INSTALL_DIR}/package-lock.json"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "${TMP_INSTALL_DIR}" >/dev/null
else
  npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix "${TMP_INSTALL_DIR}" >/dev/null
fi

NODE_BIN="$(command -v node)"

python3 - "${TMP_INSTALL_DIR}/supabase-mcp-guard" "${NODE_BIN}" "${INSTALL_ROOT}" <<'PY'
import pathlib
import sys

target = pathlib.Path(sys.argv[1])
node_bin = sys.argv[2]
install_root = sys.argv[3]

target.write_text(f"""#!/usr/bin/env bash
set -euo pipefail
NODE_BIN="{node_bin}"
SCRIPT_PATH="{install_root}/cli.mjs"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "未找到可用 node，请重新执行安装脚本" >&2
  exit 1
fi
exec "$NODE_BIN" "$SCRIPT_PATH" "$@"
""", encoding="utf-8")
PY
chmod 755 "${TMP_INSTALL_DIR}/supabase-mcp-guard"

sudo mkdir -p "${INSTALL_ROOT}"
sudo rm -rf "${INSTALL_ROOT}/node_modules"
sudo cp "${TMP_INSTALL_DIR}/package.json" "${INSTALL_ROOT}/package.json"
if [[ -f "${TMP_INSTALL_DIR}/package-lock.json" ]]; then
  sudo cp "${TMP_INSTALL_DIR}/package-lock.json" "${INSTALL_ROOT}/package-lock.json"
fi
sudo cp "${TMP_INSTALL_DIR}/cli.mjs" "${INSTALL_ROOT}/cli.mjs"
sudo cp -R "${TMP_INSTALL_DIR}/node_modules" "${INSTALL_ROOT}/node_modules"
sudo chown -R root:wheel "${INSTALL_ROOT}"
sudo chmod -R go-w "${INSTALL_ROOT}"

sudo cp "${TMP_INSTALL_DIR}/supabase-mcp-guard" "${INSTALL_BIN}"
sudo chown root:wheel "${INSTALL_BIN}"
sudo chmod 755 "${INSTALL_BIN}"

if [[ "${CLIENT}" == "--client=codex" || "${CLIENT}" == "codex" ]]; then
  if [[ ! -f "${CODEX_CONFIG}" ]]; then
    echo "未找到 ${CODEX_CONFIG}，跳过 Codex 配置写入" >&2
  else
    python3 - "${CODEX_CONFIG}" "${BACKUP_SUFFIX}" <<'PY'
import pathlib
import sys

config_path = pathlib.Path(sys.argv[1])
backup_suffix = sys.argv[2]
content = config_path.read_text(encoding="utf-8")

replacement = """[mcp_servers.supabase]
command = "/usr/local/bin/supabase-mcp-guard"
startup_timeout_sec = 30
"""

marker = "[mcp_servers.supabase]"
if marker in content:
    start = content.index(marker)
    next_section = content.find("\n[", start + len(marker))
    if next_section == -1:
        updated = content[:start].rstrip() + "\n\n" + replacement + "\n"
    else:
        updated = content[:start].rstrip() + "\n\n" + replacement + content[next_section:]
else:
    updated = content.rstrip() + "\n\n" + replacement + "\n"

backup = config_path.with_name(config_path.name + f".bak.{backup_suffix}")
backup.write_text(content, encoding="utf-8")
config_path.write_text(updated, encoding="utf-8")
PY
  fi
fi

"${INSTALL_BIN}" --self-test >/dev/null

echo
echo "安装完成。"
echo "配置文件: ${CONFIG_FILE}"
echo "日志文件: ${LOG_FILE}"
echo "当前写保护默认开启，可用以下命令查看状态:"
echo "  ${INSTALL_BIN} status"
echo "如需临时放开写操作:"
echo "  ${INSTALL_BIN} unlock --minutes 10"
echo "完成后重新上锁:"
echo "  ${INSTALL_BIN} lock"
echo "Codex 配置片段可通过以下命令查看:"
echo "  ${INSTALL_BIN} print-snippet --client codex"
