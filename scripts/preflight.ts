import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectRoot, "..");

export type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

type ProtocolConfig = {
  maxProgrammableTxCommands?: unknown;
  maxInputObjects?: unknown;
};

type Paths = {
  transferPolicy: string;
  aegisMoveEnclave: string;
  aegisRustEnclave: string;
  aegisRegisterScript: string;
};

type PreflightDeps = {
  exec: (command: string, args: string[]) => Promise<string>;
  exists: (targetPath: string) => Promise<boolean>;
  protocolConfig: () => Promise<ProtocolConfig>;
  paths: Paths;
};

const defaultPaths: Paths = {
  transferPolicy: path.join(
    homedir(),
    ".move/https___github_com_MystenLabs_sui_git_mainnet/crates/sui-framework/packages/sui-framework/sources/kiosk/transfer_policy.move",
  ),
  aegisMoveEnclave: path.join(repoRoot, "aegis-wallet/move/enclave"),
  aegisRustEnclave: path.join(repoRoot, "aegis-wallet/enclave"),
  aegisRegisterScript: path.join(repoRoot, "aegis-wallet/scripts/register-nautilus-enclave.ts"),
};

const defaultExec: PreflightDeps["exec"] = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { cwd: projectRoot });
  return stdout;
};

const defaultExists: PreflightDeps["exists"] = async (targetPath) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

function rpcUrl(): string {
  if (process.env.SUI_RPC_URL) {
    return process.env.SUI_RPC_URL;
  }

  return process.env.SUI_NETWORK === "testnet"
    ? "https://fullnode.testnet.sui.io:443"
    : "https://fullnode.mainnet.sui.io:443";
}

const defaultProtocolConfig: PreflightDeps["protocolConfig"] = async () => {
  const response = await fetch(rpcUrl(), {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "sui_getProtocolConfig",
      params: [],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  const body = (await response.json()) as {
    error?: { message?: string };
    result?: {
      attributes?: Record<string, unknown>;
    };
  };

  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `protocol config request failed: ${response.status}`);
  }

  const attributes = body.result?.attributes ?? {};
  return {
    maxInputObjects: attributes.max_input_objects ?? attributes.maxInputObjects,
    maxProgrammableTxCommands:
      attributes.max_programmable_tx_commands ?? attributes.maxProgrammableTxCommands,
  };
};

function asBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && value.length > 0) {
    return BigInt(value);
  }

  if (value && typeof value === "object") {
    for (const typedValue of Object.values(value)) {
      const parsed = asBigInt(typedValue);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  return undefined;
}

function versionCheck(name: string, output: string, pattern: RegExp): Check {
  return {
    name,
    ok: pattern.test(output),
    detail: output.trim(),
  };
}

function limitCheck(name: string, value: unknown, minimum: bigint): Check {
  const parsed = asBigInt(value);

  return {
    name,
    ok: parsed !== undefined && parsed >= minimum,
    detail: parsed === undefined ? "missing" : `${parsed} >= ${minimum}`,
  };
}

async function pathCheck(name: string, targetPath: string, exists: PreflightDeps["exists"]) {
  const ok = await exists(targetPath);
  return {
    name,
    ok,
    detail: targetPath,
  };
}

export async function runPreflight(overrides: Partial<PreflightDeps> = {}): Promise<Check[]> {
  const deps: PreflightDeps = {
    exec: overrides.exec ?? defaultExec,
    exists: overrides.exists ?? defaultExists,
    paths: overrides.paths ?? defaultPaths,
    protocolConfig: overrides.protocolConfig ?? defaultProtocolConfig,
  };

  const [suiVersion, pnpmVersion, protocol] = await Promise.all([
    deps.exec("sui", ["--version"]),
    deps.exec("pnpm", ["--version"]),
    deps.protocolConfig(),
  ]);

  const checks: Check[] = [
    versionCheck("sui cli", suiVersion, /^sui 1\./),
    versionCheck("pnpm", pnpmVersion, /^11\./),
    limitCheck("protocol.maxProgrammableTxCommands", protocol.maxProgrammableTxCommands, 1024n),
    limitCheck("protocol.maxInputObjects", protocol.maxInputObjects, 2048n),
    await pathCheck("transfer_policy.move", deps.paths.transferPolicy, deps.exists),
    await pathCheck("Aegis Move enclave", deps.paths.aegisMoveEnclave, deps.exists),
    await pathCheck("Aegis Rust enclave", deps.paths.aegisRustEnclave, deps.exists),
    await pathCheck("Aegis register script", deps.paths.aegisRegisterScript, deps.exists),
  ];

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    throw new Error(`preflight failed: ${failed.map((check) => check.name).join(", ")}`);
  }

  return checks;
}

function printReport(checks: Check[]) {
  console.table(
    checks.map((check) => ({
      check: check.name,
      detail: check.detail,
      status: check.ok ? "OK" : "FAIL",
    })),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runPreflight();
    printReport(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
