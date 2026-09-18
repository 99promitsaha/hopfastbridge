import fs from "node:fs";
import { JsonRpcProvider, Wallet, ContractFactory, isAddress } from "ethers";
const {
  ARC_RPC_URL,
  DEPLOYER_PRIVATE_KEY,
  ARCHITECT_ADMIN_ADDRESS,
  ARCHITECT_TREASURY_ADDRESS,
  ARCHITECT_SIGNER_ADDRESS,
} = process.env;
for (const value of [
  ARCHITECT_ADMIN_ADDRESS,
  ARCHITECT_TREASURY_ADDRESS,
  ARCHITECT_SIGNER_ADDRESS,
])
  if (!value || !isAddress(value))
    throw new Error("Set admin, treasury and authorization signer addresses.");
if (!ARC_RPC_URL || !DEPLOYER_PRIVATE_KEY)
  throw new Error(
    "Set ARC_RPC_URL and DEPLOYER_PRIVATE_KEY. Never put the deployer key in frontend settings.",
  );
const provider = new JsonRpcProvider(ARC_RPC_URL);
const { chainId } = await provider.getNetwork();
if (![5042n, 5042002n].includes(chainId))
  throw new Error("Deployment restricted to Arc mainnet or testnet.");
if (process.env.CONFIRM_DEPLOY !== `arc-${chainId}`)
  throw new Error(
    `Review the contract before deployment, then set CONFIRM_DEPLOY=arc-${chainId}.`,
  );
const artifact = JSON.parse(fs.readFileSync("artifacts/ArchitectEscrow.json"));
const contract = await new ContractFactory(
  artifact.abi,
  artifact.evm.bytecode.object,
  new Wallet(DEPLOYER_PRIVATE_KEY, provider),
).deploy(
  "0x3600000000000000000000000000000000000000",
  ARCHITECT_ADMIN_ADDRESS,
  ARCHITECT_TREASURY_ADDRESS,
  ARCHITECT_SIGNER_ADDRESS,
);
await contract.waitForDeployment();
console.log(
  JSON.stringify({
    chainId: chainId.toString(),
    contract: await contract.getAddress(),
    transaction: contract.deploymentTransaction().hash,
  }),
);
