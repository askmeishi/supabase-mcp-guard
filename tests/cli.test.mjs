import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const cliPath = resolve(repoRoot, "src", "cli.mjs");
const macosInstallerPath = resolve(repoRoot, "scripts", "install_macos.sh");
const windowsInstallerPath = resolve(repoRoot, "scripts", "install_windows.ps1");

test("self-test works even when config file does not exist", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "supabase-mcp-guard-self-test-"));
  const missingConfigPath = resolve(tempDir, "missing-config.json");

  try {
    const result = spawnSync(process.execPath, [cliPath, "--self-test", "--config", missingConfigPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.config_exists, false);
    assert.equal(payload.config_path, missingConfigPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("classifySql treats read-only CTE queries as read", () => {
  const script = `
    import { classifySql } from ${JSON.stringify(pathToFileURL(cliPath).href)};
    console.log(JSON.stringify(classifySql("with sample as (select 1 as id) select * from sample")));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.type, "read");
});

test("macOS installer copies the full src runtime and points wrapper at src/cli.mjs", () => {
  const script = readFileSync(macosInstallerPath, "utf8");

  assert.match(script, /cp -R "\$\{REPO_ROOT\}\/src" "\$\{TMP_INSTALL_DIR\}\/src"/);
  assert.match(script, /SCRIPT_PATH="\{install_root\}\/src\/cli\.mjs"/);
});

test("Windows installer copies the full src runtime and points wrapper at src/cli.mjs", () => {
  const script = readFileSync(windowsInstallerPath, "utf8");

  assert.match(script, /Copy-Item \(Join-Path \$repoRoot "src"\) \(Join-Path \$tmpInstallDir "src"\) -Recurse -Force/);
  assert.match(script, /\$installRoot\\src\\cli\.mjs/);
});
