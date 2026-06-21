import { describe, expect, test } from "vitest";
import {
  buildCreateEnclaveCapTx,
  buildCreateEnclaveConfigTx,
  buildRegisterEnclaveTx,
} from "../src/enclave.js";

const PKG = "0xcafe";
const WITNESS = `${PKG}::attested::CH_WITNESS`;

// biome-ignore lint/suspicious/noExplicitAny: probing untyped TransactionData shape
type AnyCmd = any;

describe("enclave registration PTBs", () => {
  test("create_enclave_cap → one attested::create_enclave_cap call", () => {
    const calls: AnyCmd[] = buildCreateEnclaveCapTx({ packageId: PKG })
      .getData()
      .commands.map((c: AnyCmd) => c.MoveCall);
    expect(calls).toHaveLength(1);
    expect(calls[0].module).toBe("attested");
    expect(calls[0].function).toBe("create_enclave_cap");
  });

  test("create_enclave_config → enclave::create_enclave_config<CH_WITNESS>", () => {
    const tx = buildCreateEnclaveConfigTx({
      packageId: PKG,
      capId: "0xca9",
      name: "clearinghouse-grader",
      pcr0: new Uint8Array([1, 2, 3]),
      pcr1: new Uint8Array([4, 5, 6]),
      pcr2: new Uint8Array([7, 8, 9]),
    });
    const call = tx.getData().commands.at(0)?.MoveCall as AnyCmd;
    expect(call.module).toBe("enclave");
    expect(call.function).toBe("create_enclave_config");
    expect(call.typeArguments).toEqual([WITNESS]);
  });

  test("register_enclave → load_nitro_attestation then register_enclave<CH_WITNESS>", () => {
    const calls: AnyCmd[] = buildRegisterEnclaveTx({
      packageId: PKG,
      configId: "0xc0f",
      attestationDocument: new Uint8Array([0, 1, 2, 3]),
    })
      .getData()
      .commands.map((c: AnyCmd) => c.MoveCall);

    expect(calls.map((c) => c.function)).toEqual(["load_nitro_attestation", "register_enclave"]);
    expect(calls[0].module).toBe("nitro_attestation");
    expect(calls[1].typeArguments).toEqual([WITNESS]);
  });
});
