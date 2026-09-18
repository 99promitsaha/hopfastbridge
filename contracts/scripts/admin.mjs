import fs from "node:fs";
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  keccak256,
  toUtf8Bytes,
} from "ethers";
const { ARC_RPC_URL, ARCHITECT_ESCROW_ADDRESS, ADMIN_PRIVATE_KEY } =
  process.env;
if (!ARC_RPC_URL || !ARCHITECT_ESCROW_ADDRESS || !ADMIN_PRIVATE_KEY)
  throw new Error(
    "Set RPC, escrow address and admin wallet credentials locally. A multisig can call these functions directly instead.",
  );
const provider = new JsonRpcProvider(ARC_RPC_URL);
const { chainId } = await provider.getNetwork();
if (![5042n, 5042002n].includes(chainId)) throw new Error("Arc only.");
const escrow = new Contract(
  ARCHITECT_ESCROW_ADDRESS,
  JSON.parse(fs.readFileSync("artifacts/ArchitectEscrow.json")).abi,
  new Wallet(ADMIN_PRIVATE_KEY, provider),
);
const [operation, id, recipient, reason] = process.argv.slice(2);
let tx;
if (operation === "queue" && reason)
  tx = await escrow.queueRecovery(
    id,
    recipient,
    keccak256(toUtf8Bytes(reason)),
  );
else if (operation === "cancel") tx = await escrow.cancelRecovery(id);
else if (operation === "execute") tx = await escrow.executeRecovery(id);
else
  throw new Error(
    "Usage: node scripts/admin.mjs queue <id> <recipient> <reason> | cancel <id> | execute <id>",
  );
await tx.wait();
console.log(`Confirmed ${operation}: ${tx.hash}`);
