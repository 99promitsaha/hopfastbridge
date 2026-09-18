import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import artifact from "../contracts/ArchitectEscrow.json";
import type { PrivyWalletBridge } from "../components/WalletConnector";
export type ArchitectConfig = {
  ready: boolean;
  deliveryEnabled?: boolean;
  contract?: Address;
  chainId: number;
  rpcUrl: string;
  feeBps: number;
};
export type Envelope = {
  envelopeId: Hex;
  handle: string;
  message: string;
  gross: string;
  funder: Address;
  state: number;
  expiresAt: number;
};
const base = (
  import.meta.env.VITE_HOPFAST_API_BASE_URL ||
  (["localhost", "127.0.0.1"].includes(location.hostname)
    ? `http://${location.hostname}:8080/api`
    : "/api")
).replace(/\/$/, "");
export async function architectApi<T>(
  path: string,
  body?: unknown,
  access?: string,
): Promise<T> {
  const response = await fetch(`${base}/architects${path}`, {
    credentials: "include",
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result;
}
export async function walletProof(wallet: PrivyWalletBridge) {
  const challenge = await architectApi<{ nonce: string; message: string }>(
    "/challenge",
    { wallet: wallet.address },
  );
  const provider = await wallet.getEthereumProvider();
  const signature = await provider.request({
    method: "personal_sign",
    params: [
      `0x${Array.from(new TextEncoder().encode(challenge.message))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}`,
      wallet.address,
    ],
  });
  return { nonce: challenge.nonce, signature };
}
export async function escrowWrite(
  config: ArchitectConfig,
  wallet: PrivyWalletBridge,
  method: string,
  args: unknown[],
) {
  if (!config.contract) throw new Error("Escrow is not configured.");
  await wallet.switchChain(config.chainId);
  const provider = await wallet.getEthereumProvider();
  const signer = createWalletClient({
    account: wallet.address as Address,
    transport: custom(provider),
  });
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  if ((await publicClient.getChainId()) !== config.chainId)
    throw new Error("Arc RPC network does not match.");
  if (method === "deposit") {
    const gross = BigInt(String(args[2]));
    const token = "0x3600000000000000000000000000000000000000";
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet.address as Address, config.contract],
    });
    if (allowance < gross) {
      const approval = await signer.writeContract({
        chain: null,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [config.contract, gross],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: approval,
      });
      if (receipt.status !== "success")
        throw new Error("USDC approval failed.");
    }
  }
  const simulation = await publicClient.simulateContract({
    account: wallet.address as Address,
    address: config.contract,
    abi: artifact.abi,
    functionName: method,
    args,
  });
  const tx = await signer.writeContract({ ...simulation.request, chain: null });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error("The transaction did not complete.");
  return tx;
}
