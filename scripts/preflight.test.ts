import { describe, expect, test } from "vitest";
import { runPreflight } from "./preflight.js";

describe("runPreflight", () => {
  test("checks protocol limits, tool versions, and local reference paths", async () => {
    const report = await runPreflight({
      exec: async (command, args) => {
        if (command === "sui" && args.join(" ") === "--version") {
          return "sui 1.73.0-homebrew\n";
        }

        if (command === "pnpm" && args.join(" ") === "--version") {
          return "11.5.0\n";
        }

        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
      exists: async (path) =>
        [
          "/tmp/transfer_policy.move",
          "/tmp/aegis/move/enclave",
          "/tmp/aegis/enclave",
          "/tmp/aegis/scripts/register-nautilus-enclave.ts",
        ].includes(path),
      protocolConfig: async () => ({
        maxProgrammableTxCommands: "1024",
        maxInputObjects: "2048",
      }),
      paths: {
        transferPolicy: "/tmp/transfer_policy.move",
        aegisMoveEnclave: "/tmp/aegis/move/enclave",
        aegisRustEnclave: "/tmp/aegis/enclave",
        aegisRegisterScript: "/tmp/aegis/scripts/register-nautilus-enclave.ts",
      },
    });

    expect(report.every((check) => check.ok)).toBe(true);
    expect(report.map((check) => check.name)).toEqual([
      "sui cli",
      "pnpm",
      "protocol.maxProgrammableTxCommands",
      "protocol.maxInputObjects",
      "transfer_policy.move",
      "Aegis Move enclave",
      "Aegis Rust enclave",
      "Aegis register script",
    ]);
  });

  test("fails when a required protocol limit is too low", async () => {
    await expect(
      runPreflight({
        exec: async (command, args) => {
          if (command === "sui" && args.join(" ") === "--version") {
            return "sui 1.73.0-homebrew\n";
          }

          if (command === "pnpm" && args.join(" ") === "--version") {
            return "11.5.0\n";
          }

          throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
        },
        exists: async () => true,
        protocolConfig: async () => ({
          maxProgrammableTxCommands: "128",
          maxInputObjects: "2048",
        }),
        paths: {
          transferPolicy: "/tmp/transfer_policy.move",
          aegisMoveEnclave: "/tmp/aegis/move/enclave",
          aegisRustEnclave: "/tmp/aegis/enclave",
          aegisRegisterScript: "/tmp/aegis/scripts/register-nautilus-enclave.ts",
        },
      }),
    ).rejects.toThrow("preflight failed");
  });
});
