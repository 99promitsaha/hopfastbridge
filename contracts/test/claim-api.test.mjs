import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import express from "../../backend/node_modules/express/index.js";
import mongoose from "../../backend/node_modules/mongoose/index.js";
import { BrowserProvider, ContractFactory, Wallet } from "ethers";

test("API rejects stolen links, wallet replay, wrong X identity and reused OAuth state; matching account claims", async () => {
  const chain = ganache.server({
    logging: { quiet: true },
    chain: { chainId: 5042 },
  });
  await chain.listen(0, "127.0.0.1");
  const provider = new BrowserProvider(chain.provider);
  provider.pollingInterval = 10;
  const owner = await provider.getSigner(0),
    funder = await provider.getSigner(1);
  const funderWallet = new Wallet(
    chain.provider.getInitialAccounts()[
      (await funder.getAddress()).toLowerCase()
    ].secretKey,
  );
  const recipient = Wallet.createRandom(),
    authorizationSigner = Wallet.createRandom();
  const tokenArtifact = JSON.parse(fs.readFileSync("artifacts/MockUSDC.json"));
  const escrowArtifact = JSON.parse(
    fs.readFileSync("artifacts/ArchitectEscrow.json"),
  );
  const usdc = await new ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner,
  ).deploy();
  await usdc.waitForDeployment();
  const escrow = await new ContractFactory(
    escrowArtifact.abi,
    escrowArtifact.evm.bytecode.object,
    owner,
  ).deploy(
    await usdc.getAddress(),
    await owner.getAddress(),
    await owner.getAddress(),
    authorizationSigner.address,
  );
  await escrow.waitForDeployment();
  Object.assign(process.env, {
    NODE_ENV: "test",
    ARCHITECT_ESCROW_ADDRESS: await escrow.getAddress(),
    ARCHITECT_SIGNER_KEY: authorizationSigner.privateKey,
    ARCHITECT_CHAIN_ID: "5042",
    ARC_RPC_URL: `http://127.0.0.1:${chain.address().port}`,
    X_BEARER_TOKEN: "fixture",
    X_CLIENT_ID: "fixture",
    X_CALLBACK_URL: "http://localhost:8080/api/architects/x/callback",
    APP_BASE_URL: "http://localhost:5173",
    X_DELIVERY_ENABLED: "false",
  });
  const { ArchitectAuth, ArchitectEnvelope } = await import(
    "../../backend/dist/models/ArchitectEnvelope.js"
  );
  const records = { auth: [], envelope: [] };
  let sequence = 0;
  const matches = (record, query) =>
    Object.entries(query).every(([key, value]) =>
      value && typeof value === "object" && "$gt" in value
        ? record[key] > value.$gt
        : record[key] === value,
    );
  for (const [model, key] of [
    [ArchitectAuth, "auth"],
    [ArchitectEnvelope, "envelope"],
  ]) {
    model.create = async (data) => {
      const record = { _id: String(++sequence), ...data };
      records[key].push(record);
      return record;
    };
    model.findOne = async (query) =>
      records[key].find((record) => matches(record, query)) ?? null;
    model.findOneAndDelete = async (query) => {
      const i = records[key].findIndex((record) => matches(record, query));
      return i < 0 ? null : records[key].splice(i, 1)[0];
    };
  }
  // Isolate persistence in memory; never touch the user's Mongo database.
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true,
  });
  const actualFetch = globalThis.fetch;
  let signedInId = "wrong-account";
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "https://api.x.com/2/oauth2/token")
      return new Response(
        JSON.stringify({ access_token: "fixture-user-token" }),
        { status: 200 },
      );
    if (path === "https://api.x.com/2/users/me")
      return new Response(
        JSON.stringify({
          data: { id: signedInId, username: "renamed_builder" },
        }),
        { status: 200 },
      );
    if (path.startsWith("https://api.x.com/2/users/by/username/"))
      return new Response(
        JSON.stringify({ data: { id: "12345", username: "builder" } }),
        { status: 200 },
      );
    return actualFetch(url, options);
  };
  const { default: router } = await import(
    "../../backend/dist/routes/architects.routes.js"
  );
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/architects`;
  const post = async (path, body, access) =>
    actualFetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const proof = async (wallet) => {
    const challenge = await (
      await post("/challenge", { wallet: wallet.address })
    ).json();
    return {
      nonce: challenge.nonce,
      signature: await wallet.signMessage(challenge.message),
    };
  };
  try {
    const walletProof = await proof(funderWallet);
    const draftResponse = await post("/envelopes", {
      handle: "builder",
      amount: "25",
      message: "Keep building.",
      ...walletProof,
    });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    assert.equal(
      (
        await post("/envelopes", {
          handle: "builder",
          amount: "25",
          message: "Keep building.",
          ...walletProof,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          `/envelopes/${draft.envelopeId}/x`,
          await proof(recipient),
          draft.access,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await actualFetch(`${base}/envelopes/${draft.envelopeId}`, {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      404,
    );
    await (await usdc.mint(await funder.getAddress(), 25000000n)).wait();
    await (
      await usdc.connect(funder).approve(await escrow.getAddress(), 25000000n)
    ).wait();
    await (
      await escrow
        .connect(funder)
        .deposit(draft.envelopeId, draft.xIdentity, 25000000n)
    ).wait();
    async function login(cookieOverride) {
      const start = await post(
        `/envelopes/${draft.envelopeId}/x`,
        await proof(recipient),
        draft.access,
      );
      assert.equal(start.status, 200);
      const { url: authorizeUrl } = await start.json();
      const authorizeTarget = new URL(authorizeUrl);
      const authorize = await actualFetch(
        `${base}${authorizeTarget.pathname.replace("/api/architects", "")}${authorizeTarget.search}`,
        { redirect: "manual" },
      );
      assert.equal(authorize.status, 302);
      const url = authorize.headers.get("location");
      const state = new URL(url).searchParams.get("state");
      assert.equal(
        new URL(url).searchParams.get("code_challenge_method"),
        "S256",
      );
      const cookie =
        cookieOverride ?? authorize.headers.get("set-cookie").split(";")[0];
      const callback = await actualFetch(
        `${base}/x/callback?state=${state}&code=fixture`,
        { headers: { Cookie: cookie }, redirect: "manual" },
      );
      return { callback, state, cookie };
    }
    const invalidAuthorize = new URL(
      (await (await post(
        `/envelopes/${draft.envelopeId}/x`,
        await proof(recipient),
        draft.access,
      )).json()).url,
    );
    invalidAuthorize.searchParams.set("browser", "wrong-browser");
    assert.match(
      (await actualFetch(
        `${base}${invalidAuthorize.pathname.replace("/api/architects", "")}${invalidAuthorize.search}`,
        { redirect: "manual" },
      )).headers.get("location"),
      /claimError/,
    );
    assert.match(
      (await login("hf_x_state=wrong")).callback.headers.get("location"),
      /claimError/,
    );
    assert.match(
      (await login()).callback.headers.get("location"),
      /claimError/,
    );
    signedInId = "12345";
    const valid = await login();
    const session = new URLSearchParams(
      new URL(valid.callback.headers.get("location")).hash.slice(1),
    ).get("session");
    assert.ok(session);
    assert.equal(
      (await post(`/envelopes/${draft.envelopeId}/authorization`, {}, "wrong"))
        .status,
      401,
    );
    const response = await post(
      `/envelopes/${draft.envelopeId}/authorization`,
      {},
      session,
    );
    assert.equal(response.status, 200);
    const auth = await response.json();
    assert.equal(auth.recipient.toLowerCase(), recipient.address.toLowerCase());
    await chain.provider.request({
      method: "evm_setAccountBalance",
      params: [recipient.address, "0xde0b6b3a7640000"],
    });
    await (
      await escrow
        .connect(recipient.connect(provider))
        .claim(
          draft.envelopeId,
          recipient.address,
          auth.deadline,
          auth.signature,
        )
    ).wait();
    assert.equal(await usdc.balanceOf(recipient.address), 24375000n);
    assert.equal(
      (await post(`/envelopes/${draft.envelopeId}/authorization`, {}, session))
        .status,
      409,
    );
    const replay = await actualFetch(
      `${base}/x/callback?state=${valid.state}&code=fixture`,
      { headers: { Cookie: valid.cookie }, redirect: "manual" },
    );
    assert.match(replay.headers.get("location"), /claimError/);
    // Test local deployment review and strict receipt validation without touching real settings.
    const { env } = await import("../../backend/dist/config/env.js");
    const { default: deploymentRouter } = await import(
      "../../backend/dist/routes/architectDeployment.routes.js"
    );
    app.use("/api", deploymentRouter);
    const deploymentBase = `http://127.0.0.1:${server.address().port}/api/architect-deployment`;
    assert.equal((await actualFetch(deploymentBase)).status, 404);
    env.NODE_ENV = "development";
    env.ARCHITECT_ADMIN_ADDRESS = await funder.getAddress();
    env.ARCHITECT_TREASURY_ADDRESS = await owner.getAddress();
    env.ARCHITECT_ESCROW_ADDRESS = undefined;
    const planResponse = await actualFetch(deploymentBase);
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.chainId, 5042);
    const confirm = async (body) =>
      actualFetch(`${deploymentBase}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await confirm({
          nonce: "wrong",
          txHash: escrow.deploymentTransaction().hash,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await confirm({
          nonce: plan.nonce,
          txHash: escrow.deploymentTransaction().hash,
        })
      ).status,
      400,
    );
    const deploymentTx = await funder.sendTransaction({ data: plan.data });
    const deploymentReceipt = await deploymentTx.wait();
    const directory = fs.mkdtempSync("/private/tmp/hopfast-deployment-test-");
    const previousCwd = process.cwd();
    try {
      fs.writeFileSync(`${directory}/.env`, "# isolated deployment settings\n");
      process.chdir(directory);
      const result = await confirm({
        nonce: plan.nonce,
        txHash: deploymentTx.hash,
      });
      assert.equal(result.status, 200);
      assert.equal(
        (await result.json()).contract.toLowerCase(),
        deploymentReceipt.contractAddress.toLowerCase(),
      );
      assert.match(
        fs.readFileSync(".env", "utf8"),
        /^ARCHITECT_ESCROW_ADDRESS=0x/m,
      );
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = actualFetch;
    await new Promise((resolve) => server.close(resolve));
    await chain.close();
  }
});
