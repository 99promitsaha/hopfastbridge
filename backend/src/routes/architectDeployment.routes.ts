import { Router } from "express";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  http,
  encodeDeployData,
  formatUnits,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { env } from "../config/env.js";
import artifact from "../contracts/ArchitectEscrow.json" with { type: "json" };
const router = Router();
const nonce = randomBytes(32).toString("hex");
const client = createPublicClient({ transport: http(env.ARC_RPC_URL) });
router.use("/architect-deployment", (req, res, next) => {
  if (
    env.NODE_ENV !== "development" ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    )
  )
    return res.status(404).end();
  next();
});
function deployment() {
  if (
    !env.ARCHITECT_ADMIN_ADDRESS ||
    !env.ARCHITECT_TREASURY_ADDRESS ||
    !env.ARCHITECT_SIGNER_KEY
  )
    throw new Error("Deployment addresses are missing.");
  const admin = env.ARCHITECT_ADMIN_ADDRESS as Address,
    treasury = env.ARCHITECT_TREASURY_ADDRESS as Address;
  const signer = privateKeyToAccount(env.ARCHITECT_SIGNER_KEY as Hex).address;
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: [
      "0x3600000000000000000000000000000000000000",
      admin,
      treasury,
      signer,
    ],
  });
  return { admin, treasury, signer, data };
}
router.get("/architect-deployment", async (_req, res) => {
  try {
    if ((await client.getChainId()) !== 5042)
      throw new Error("This review requires Arc mainnet.");
    const plan = deployment();
    const [gas, fees, balance] = await Promise.all([
      client.estimateGas({ account: plan.admin, data: plan.data }),
      client.estimateFeesPerGas(),
      client.getBalance({ address: plan.admin }),
    ]);
    const gasLimit = (gas * 120n) / 100n,
      maxFeePerGas = fees.maxFeePerGas;
    res.json({
      ...plan,
      nonce,
      chainId: 5042,
      rpcUrl: env.ARC_RPC_URL,
      existingContract: env.ARCHITECT_ESCROW_ADDRESS,
      gas: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      maxGasUsdc: formatUnits(gasLimit * maxFeePerGas, 18),
      balanceUsdc: formatUnits(balance, 18),
      canAfford: balance >= gasLimit * maxFeePerGas,
    });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e instanceof Error ? e.message : "Deployment could not be prepared.",
      });
  }
});
router.post("/architect-deployment/confirm", async (req, res) => {
  try {
    const body = z
      .object({
        nonce: z.literal(nonce),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
      .parse(req.body);
    if ((await client.getChainId()) !== 5042) throw new Error("Wrong network.");
    const plan = deployment();
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: body.txHash as Hex }),
      client.getTransactionReceipt({ hash: body.txHash as Hex }),
    ]);
    if (
      tx.from.toLowerCase() !== plan.admin.toLowerCase() ||
      tx.to !== null ||
      tx.input !== plan.data ||
      receipt.status !== "success" ||
      !receipt.contractAddress
    )
      throw new Error("Receipt does not match the prepared deployment.");
    if (
      env.ARCHITECT_ESCROW_ADDRESS &&
      env.ARCHITECT_ESCROW_ADDRESS.toLowerCase() !==
        receipt.contractAddress.toLowerCase()
    )
      throw new Error(
        "An escrow is already configured. Review before replacing it.",
      );
    const checks = await Promise.all(
      ["owner", "treasury", "authorizationSigner"].map((functionName) =>
        client.readContract({
          address: receipt.contractAddress!,
          abi: artifact.abi,
          functionName,
        }),
      ),
    );
    if (
      checks
        .map(String)
        .map((x) => x.toLowerCase())
        .join(",") !==
      [plan.admin, plan.treasury, plan.signer]
        .map((x) => x.toLowerCase())
        .join(",")
    )
      throw new Error("Deployed roles do not match.");
    const file = ".env";
    let settings = fs.readFileSync(file, "utf8");
    const line = `ARCHITECT_ESCROW_ADDRESS=${receipt.contractAddress}`;
    settings = /^ARCHITECT_ESCROW_ADDRESS=.*$/m.test(settings)
      ? settings.replace(/^ARCHITECT_ESCROW_ADDRESS=.*$/m, line)
      : `${settings.trimEnd()}\n${line}\n`;
    fs.writeFileSync(file, settings, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    env.ARCHITECT_ESCROW_ADDRESS = receipt.contractAddress;
    res.json({ contract: receipt.contractAddress, txHash: body.txHash });
  } catch {
    res
      .status(400)
      .json({
        error:
          "Deployment could not be verified or saved. Your transaction is not repeated; use its hash to retry verification.",
      });
  }
});
export default router;
