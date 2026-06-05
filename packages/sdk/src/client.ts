import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Network } from "./types";

/** A JSON-RPC `SuiJsonRpcClient` for the given network. `SUI_RPC_URL` overrides
 *  the default fullnode. (v2 renamed `SuiClient`→`SuiJsonRpcClient` and
 *  `getFullnodeUrl`→`getJsonRpcFullnodeUrl`.) */
export function makeClient(network: Network): SuiJsonRpcClient {
  const url = process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(network);
  return new SuiJsonRpcClient({ network, url });
}
