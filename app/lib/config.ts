export const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID ?? "0x0";
export const REGISTRY_ID = process.env.NEXT_PUBLIC_REGISTRY_ID ?? "0x0";
export const SUI_COIN_TYPE = "0x2::sui::SUI";

export type AppNetwork = "localnet" | "testnet" | "mainnet";

export const defaultNetwork: AppNetwork =
  (process.env.NEXT_PUBLIC_SUI_NETWORK as AppNetwork) ?? "localnet";
