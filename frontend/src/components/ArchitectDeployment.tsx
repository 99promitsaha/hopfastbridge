import { useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Hex,
  type Address,
} from "viem";
import type { PrivyWalletBridge } from "./WalletConnector";
type Plan = {
  admin: Address;
  treasury: Address;
  signer: Address;
  data: Hex;
  nonce: string;
  chainId: number;
  rpcUrl: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  maxGasUsdc: string;
  balanceUsdc: string;
  canAfford: boolean;
  existingContract?: string;
};
const base = (
  import.meta.env.VITE_HOPFAST_API_BASE_URL || "http://localhost:8080/api"
).replace(/\/$/, "");
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/architect-deployment${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
export function ArchitectDeployment({
  wallet,
  onConnect,
}: {
  wallet: PrivyWalletBridge | null;
  onConnect: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [contract, setContract] = useState("");
  const [txHash, setTxHash] = useState(
    localStorage.getItem("hopfast:architect-deployment") || "",
  );
  useEffect(() => {
    request<Plan>("")
      .then(setPlan)
      .catch((e) => setError(e.message));
  }, []);
  async function confirm(hash: string) {
    const result = await request<{ contract: string }>("/confirm", {
      nonce: plan!.nonce,
      txHash: hash,
    });
    setContract(result.contract);
    localStorage.removeItem("hopfast:architect-deployment");
  }
  async function deploy() {
    if (!wallet || !plan) return;
    setBusy(true);
    setError("");
    try {
      if (wallet.address.toLowerCase() !== plan.admin.toLowerCase())
        throw new Error("Connect the configured admin wallet.");
      if (plan.existingContract)
        throw new Error("An escrow is already configured.");
      await wallet.switchChain(5042);
      const provider = await wallet.getEthereumProvider();
      if (Number(await provider.request({ method: "eth_chainId" })) !== 5042)
        throw new Error("Switch to Arc mainnet.");
      const signer = createWalletClient({
        account: wallet.address as Address,
        transport: custom(provider),
      });
      const hash = await signer.sendTransaction({
        chain: null,
        data: plan.data,
        gas: BigInt(plan.gas),
        maxFeePerGas: BigInt(plan.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(plan.maxPriorityFeePerGas),
        value: 0n,
      });
      setTxHash(hash);
      localStorage.setItem("hopfast:architect-deployment", hash);
      const receipt = await createPublicClient({
        transport: http(plan.rpcUrl),
      }).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Deployment reverted.");
      await confirm(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deployment did not finish.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="hf-content hf-architect-claim">
      <section className="hf-pay-x-form">
        <p className="hf-landing-kicker">LOCAL ADMIN SETUP</p>
        <h1>Deploy the Pay on Arc escrow.</h1>
        <p>
          Arc mainnet · chain 5042. This creates the contract and spends USDC
          for gas. No payment funds are deposited during setup.
        </p>
        {plan && (
          <>
            <label>Admin and fee treasury</label>
            <p style={{ overflowWrap: "anywhere" }}>{plan.admin}</p>
            <label>Claim authorization signer</label>
            <p style={{ overflowWrap: "anywhere" }}>{plan.signer}</p>
            <p>
              Maximum gas budget: {plan.maxGasUsdc} USDC. Wallet balance:{" "}
              {plan.balanceUsdc} USDC.
            </p>
            <small>
              2.5% is forwarded at deposit. 97.5% stays in escrow. Claims close
              after 30 days; the sender can retrieve an expired payment. Admin
              recovery waits seven days after queuing an expired payment. The
              admin can replace the claim signer and must be trusted.
            </small>
          </>
        )}
        {!wallet && <button onClick={onConnect}>Connect admin wallet</button>}
        {wallet && plan && !contract && !txHash && (
          <button
            disabled={busy || !plan.canAfford || !!plan.existingContract}
            onClick={deploy}
          >
            {busy
              ? "Waiting for your wallet…"
              : "Review mainnet deployment in wallet"}
          </button>
        )}
        {txHash && !contract && (
          <>
            <a
              href={`https://explorer.arc.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View deployment transaction
            </a>
            <button
              disabled={busy || !plan}
              onClick={async () => {
                setBusy(true);
                try {
                  await confirm(txHash);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Not confirmed yet.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Verify existing transaction
            </button>
          </>
        )}
        {contract && (
          <p>
            Deployed and configured:{" "}
            <a
              href={`https://explorer.arc.io/address/${contract}`}
              target="_blank"
              rel="noreferrer"
            >
              {contract}
            </a>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
