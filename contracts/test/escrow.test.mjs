import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  Wallet,
  keccak256,
  toUtf8Bytes,
  ZeroAddress,
} from "ethers";
const escrowArtifact = JSON.parse(
  fs.readFileSync("artifacts/ArchitectEscrow.json"),
);
const tokenArtifact = JSON.parse(fs.readFileSync("artifacts/MockUSDC.json"));
async function setup() {
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 5042 },
    wallet: { totalAccounts: 7 },
  });
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const [owner, funder, recipient, treasury, other] = await Promise.all(
    [0, 1, 2, 3, 4].map((i) => provider.getSigner(i)),
  );
  const authorizer = Wallet.createRandom();
  const token = await new ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner,
  ).deploy();
  await token.waitForDeployment();
  const escrow = await new ContractFactory(
    escrowArtifact.abi,
    escrowArtifact.evm.bytecode.object,
    owner,
  ).deploy(
    await token.getAddress(),
    await owner.getAddress(),
    await treasury.getAddress(),
    authorizer.address,
  );
  await escrow.waitForDeployment();
  await (await token.mint(await funder.getAddress(), 100000000n)).wait();
  await (
    await token.connect(funder).approve(await escrow.getAddress(), 100000000n)
  ).wait();
  const id = keccak256(toUtf8Bytes("envelope"));
  const identity = keccak256(toUtf8Bytes("x:12345"));
  const deposit = async () =>
    await (
      await escrow.connect(funder).deposit(id, identity, 25000000n)
    ).wait();
  const advance = async (seconds) => {
    await rpc.request({ method: "evm_increaseTime", params: [seconds] });
    await rpc.request({ method: "evm_mine", params: [] });
  };
  const authorization = async (
    target = recipient,
    signer = authorizer,
    chainId = 5042,
  ) => {
    const deadline = BigInt(
      (await provider.getBlock("latest")).timestamp + 600,
    );
    const signature = await signer.signTypedData(
      {
        name: "HopfastArchitectEscrow",
        version: "1",
        chainId,
        verifyingContract: await escrow.getAddress(),
      },
      {
        Claim: [
          { name: "envelopeId", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { envelopeId: id, recipient: await target.getAddress(), deadline },
    );
    return [id, await target.getAddress(), deadline, signature];
  };
  return {
    rpc,
    provider,
    owner,
    funder,
    recipient,
    treasury,
    other,
    authorizer,
    token,
    escrow,
    id,
    identity,
    deposit,
    advance,
    authorization,
  };
}
test("deposit pays 2.5% immediately; claim pays only the remaining USDC once", async () => {
  const s = await setup();
  try {
    await s.deposit();
    assert.equal(
      await s.token.balanceOf(await s.treasury.getAddress()),
      625000n,
    );
    assert.equal(await s.escrow.totalEscrow(), 24375000n);
    const args = await s.authorization();
    await (await s.escrow.connect(s.recipient).claim(...args)).wait();
    assert.equal(
      await s.token.balanceOf(await s.recipient.getAddress()),
      24375000n,
    );
    assert.equal(
      await s.token.balanceOf(await s.treasury.getAddress()),
      625000n,
    );
    assert.equal(await s.escrow.totalEscrow(), 0n);
    await assert.rejects(
      async () =>
        await (
          await s.escrow
            .connect(s.recipient)
            .claim(...args, { gasLimit: 300000 })
        ).wait(),
    );
  } finally {
    await s.rpc.disconnect();
  }
});
test("stolen link, wrong signer, wrong chain and duplicate deposits cannot take funds", async () => {
  const s = await setup();
  try {
    await s.deposit();
    await assert.rejects(s.deposit());
    await assert.rejects(
      s.escrow.connect(s.other).claim(...(await s.authorization())),
    );
    await assert.rejects(
      s.escrow
        .connect(s.recipient)
        .claim(...(await s.authorization(s.recipient, Wallet.createRandom()))),
    );
    await assert.rejects(
      s.escrow
        .connect(s.recipient)
        .claim(...(await s.authorization(s.recipient, s.authorizer, 1))),
    );
    assert.equal(await s.escrow.totalEscrow(), 24375000n);
  } finally {
    await s.rpc.disconnect();
  }
});
test("expiry refunds 97.5% to funder even when paused, and never refunds the fee", async () => {
  const s = await setup();
  try {
    await s.deposit();
    await assert.rejects(s.escrow.connect(s.funder).reclaim(s.id));
    await s.advance(30 * 86400);
    await (await s.escrow.setPaused(true)).wait();
    await assert.rejects(s.escrow.connect(s.other).reclaim(s.id));
    await assert.rejects(
      s.escrow.connect(s.recipient).claim(...(await s.authorization())),
    );
    await (
      await s.escrow.connect(s.funder).reclaim(s.id, { gasLimit: 300000 })
    ).wait();
    assert.equal(
      await s.token.balanceOf(await s.funder.getAddress()),
      99375000n,
    );
    assert.equal(
      await s.token.balanceOf(await s.treasury.getAddress()),
      625000n,
    );
  } finally {
    await s.rpc.disconnect();
  }
});
test("admin cannot drain active escrow; expired recovery waits 7 days and is cancelled by reclaim", async () => {
  const s = await setup();
  try {
    await s.deposit();
    const reason = keccak256(toUtf8Bytes("lost wallet support request"));
    await assert.rejects(
      s.escrow.queueRecovery(s.id, await s.other.getAddress(), reason),
    );
    await assert.rejects(
      s.escrow.rescueToken(
        await s.token.getAddress(),
        await s.owner.getAddress(),
        1n,
      ),
    );
    await s.advance(30 * 86400);
    await (
      await s.escrow.queueRecovery(s.id, await s.other.getAddress(), reason, {
        gasLimit: 300000,
      })
    ).wait();
    await assert.rejects(s.escrow.executeRecovery(s.id));
    await (
      await s.escrow.connect(s.funder).reclaim(s.id, { gasLimit: 300000 })
    ).wait();
    await s.advance(7 * 86400);
    await assert.rejects(s.escrow.executeRecovery(s.id));
  } finally {
    await s.rpc.disconnect();
  }
});
test("admin recovery transfers remaining USDC after delay; signer rotation invalidates old vouchers", async () => {
  const s = await setup();
  try {
    await s.deposit();
    const old = await s.authorization();
    await (
      await s.escrow.setAuthorizationSigner(Wallet.createRandom().address)
    ).wait();
    await assert.rejects(s.escrow.connect(s.recipient).claim(...old));
    await s.advance(30 * 86400);
    await (
      await s.escrow.queueRecovery(
        s.id,
        await s.other.getAddress(),
        keccak256(toUtf8Bytes("recovery")),
      )
    ).wait();
    await s.advance(7 * 86400);
    await (await s.escrow.executeRecovery(s.id, { gasLimit: 300000 })).wait();
    assert.equal(
      await s.token.balanceOf(await s.other.getAddress()),
      24375000n,
    );
    assert.equal(await s.escrow.totalEscrow(), 0n);
  } finally {
    await s.rpc.disconnect();
  }
});
