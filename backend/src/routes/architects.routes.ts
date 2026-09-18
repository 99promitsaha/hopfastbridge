import { Router } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import {
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  stringToHex,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../contracts/ArchitectEscrow.json" with { type: "json" };
import { env } from "../config/env.js";
import {
  ArchitectEnvelope,
  ArchitectAuth,
} from "../models/ArchitectEnvelope.js";
import { isDatabaseReady } from "../config/db.js";
import { sendXEnvelope } from "../lib/xDelivery.js";
const router = Router();
const random = () => randomBytes(32).toString("hex");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const client = createPublicClient({ transport: http(env.ARC_RPC_URL) });
const address = () => env.ARCHITECT_ESCROW_ADDRESS as Address;
const walletSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const token = (req: any) =>
  String(req.headers.authorization ?? "").replace(/^Bearer /, "");
const configured = () =>
  !!(
    env.ARCHITECT_ESCROW_ADDRESS &&
    env.ARCHITECT_SIGNER_KEY &&
    env.X_BEARER_TOKEN &&
    env.X_CLIENT_ID
  );
const read = async (id: string) =>
  (await client.readContract({
    address: address(),
    abi: artifact.abi,
    functionName: "envelopes",
    args: [id],
  })) as [Address, Hex, bigint, bigint, number];
async function xRequest(path: string, bearer: string) {
  const response = await fetch(`https://api.x.com/2/${path}`, {
    headers: { Authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json()) as {
    data?: { id: string; username: string };
  };
  if (!response.ok || !body.data?.id)
    throw new Error("X verification is unavailable. Please try again later.");
  return body.data;
}
router.get("/architects/config", async (_req, res, next) => {
  try {
    let ready = configured() && isDatabaseReady();
    if (ready) {
      const [chain, signer, fee, usdc, paused, treasury, owner] =
        await Promise.all([
          client.getChainId(),
          client.readContract({
            address: address(),
            abi: artifact.abi,
            functionName: "authorizationSigner",
          }),
          client.readContract({
            address: address(),
            abi: artifact.abi,
            functionName: "FEE_BPS",
          }),
          client.readContract({
            address: address(),
            abi: artifact.abi,
            functionName: "usdc",
          }),
          client.readContract({
            address: address(),
            abi: artifact.abi,
            functionName: "paused",
          }),
          client.readContract({
            address: address(),
            abi: artifact.abi,
            functionName: "treasury",
          }),
          client.readContract({
            address: address(),
            abi: artifact.abi,
            functionName: "owner",
          }),
        ]);
      ready =
        chain === env.ARCHITECT_CHAIN_ID &&
        String(signer).toLowerCase() ===
          privateKeyToAccount(
            env.ARCHITECT_SIGNER_KEY as Hex,
          ).address.toLowerCase() &&
        fee === 250n &&
        String(usdc).toLowerCase() ===
          "0x3600000000000000000000000000000000000000" &&
        !paused &&
        (!env.ARCHITECT_TREASURY_ADDRESS ||
          String(treasury).toLowerCase() ===
            env.ARCHITECT_TREASURY_ADDRESS.toLowerCase()) &&
        (!env.ARCHITECT_ADMIN_ADDRESS ||
          String(owner).toLowerCase() ===
            env.ARCHITECT_ADMIN_ADDRESS.toLowerCase());
    }
    res.json({
      ready,
      deliveryEnabled: env.X_DELIVERY_ENABLED && !!env.X_BOT_ACCESS_TOKEN,
      contract: env.ARCHITECT_ESCROW_ADDRESS,
      chainId: env.ARCHITECT_CHAIN_ID,
      rpcUrl: env.ARC_RPC_URL,
      feeBps: 250,
      admin: env.ARCHITECT_ADMIN_ADDRESS,
      treasury: env.ARCHITECT_TREASURY_ADDRESS,
    });
  } catch {
    res.json({
      ready: false,
      contract: env.ARCHITECT_ESCROW_ADDRESS,
      chainId: env.ARCHITECT_CHAIN_ID,
      rpcUrl: env.ARC_RPC_URL,
      feeBps: 250,
      error: "Escrow configuration has not been verified.",
    });
  }
});
router.use(
  "/architects",
  rateLimit({
    windowMs: 60000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Please wait before trying again." },
  }),
);
router.use("/architects", (_req, res, next) => {
  if (!configured() || !isDatabaseReady())
    return res.status(503).json({
      error: "Support Architects is awaiting escrow and X configuration.",
    });
  next();
});
router.post("/architects/challenge", async (req, res, next) => {
  try {
    const wallet = walletSchema.parse(req.body.wallet).toLowerCase();
    const nonce = random();
    const message = `Hopfast Support Architects\nOrigin: ${env.APP_BASE_URL}\nChain: ${env.ARCHITECT_CHAIN_ID}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(Date.now() + 300000).toISOString()}\nAuthenticate only. No funds are transferred.`;
    await ArchitectAuth.create({
      tokenHash: hash(nonce),
      kind: "challenge",
      wallet,
      message,
      expiresAt: new Date(Date.now() + 300000),
    });
    res.json({ nonce, message });
  } catch (e) {
    next(e);
  }
});
async function authenticate(body: any) {
  const proof = await ArchitectAuth.findOne({
    tokenHash: hash(String(body.nonce)),
    kind: "challenge",
    expiresAt: { $gt: new Date() },
  });
  if (
    !proof ||
    !(await verifyMessage({
      address: proof.wallet as Address,
      message: proof.message!,
      signature: body.signature,
    }))
  )
    throw new Error("Wallet authentication failed.");
  const consumed = await ArchitectAuth.findOneAndDelete({ _id: proof._id });
  if (!consumed) throw new Error("Wallet challenge has already been used.");
  return proof.wallet!;
}
router.post("/architects/envelopes", async (req, res, next) => {
  try {
    const data = z
      .object({
        handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
        amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
        message: z.string().trim().min(1).max(280),
      })
      .parse(req.body);
    const gross = parseUnits(data.amount, 6);
    if (gross <= (gross * 250n + 9999n) / 10000n || gross > 1000000n * 1000000n)
      return res.status(400).json({ error: "Enter a valid USDC amount." });
    const funder = await authenticate(req.body);
    const user = await xRequest(
      `users/by/username/${data.handle}`,
      env.X_BEARER_TOKEN!,
    );
    const envelopeId = `0x${random()}`;
    const access = random();
    const xIdentity = keccak256(stringToHex(`x:${user.id}`));
    await ArchitectEnvelope.create({
      envelopeId,
      funder,
      xId: user.id,
      handle: user.username,
      xIdentity,
      gross: gross.toString(),
      message: data.message,
      accessHash: hash(access),
    });
    res.json({
      envelopeId,
      xIdentity,
      gross: gross.toString(),
      access,
      handle: user.username,
      claimUrl: `${env.APP_BASE_URL}/?envelope=${envelopeId}#access=${access}`,
    });
  } catch (e) {
    next(e);
  }
});
router.post("/architects/mine", async (req, res, next) => {
  try {
    const wallet = await authenticate(req.body);
    const records = await ArchitectEnvelope.find({ funder: wallet })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({
      envelopes: await Promise.all(
        records.map(async (e) => {
          const chain = await read(e.envelopeId);
          return {
            envelopeId: e.envelopeId,
            handle: e.handle,
            message: e.message,
            gross: e.gross,
            funder: e.funder,
            state: chain[4],
            expiresAt: Number(chain[3]) * 1000,
          };
        }),
      ),
    });
  } catch (e) {
    next(e);
  }
});
router.post("/architects/envelopes/:id/deliver", async (req, res, next) => {
  try {
    if (!env.X_DELIVERY_ENABLED || !env.X_BOT_ACCESS_TOKEN)
      return res.status(503).json({
        error:
          "Agent delivery is not enabled. Share the private claim link instead.",
      });
    const wallet = await authenticate(req.body);
    const access = token(req);
    const e = await ArchitectEnvelope.findOne({
      envelopeId: req.params.id,
      funder: wallet,
      accessHash: hash(access),
    });
    if (!e) return res.status(404).json({ error: "Envelope not found." });
    const chain = await read(e.envelopeId);
    if (
      chain[4] !== 1 ||
      chain[1] !== e.xIdentity ||
      chain[2].toString() !== e.gross ||
      chain[0].toLowerCase() !== e.funder ||
      chain[3] * 1000n <= BigInt(Date.now())
    )
      return res
        .status(409)
        .json({ error: "Envelope is not funded or has expired." });
    const locked = await ArchitectEnvelope.findOneAndUpdate(
      { _id: e._id, deliveryState: "not_sent" },
      { $set: { deliveryState: "sending" } },
      { new: true },
    );
    if (!locked)
      return res.status(409).json({
        error:
          "Delivery has already been attempted. Share the link if they have not received it.",
      });
    const gross = BigInt(e.gross),
      net = gross - (gross * 250n + 9999n) / 10000n;
    const text = `@${e.handle}, an architect has backed your work on Arc with ${formatUnits(net, 6)} USDC.\n\n${e.message}\n\nVerify your X account and claim before ${new Date(Number(chain[3]) * 1000).toISOString()}:\n${env.APP_BASE_URL}/?envelope=${e.envelopeId}#access=${access}\n\nHopfast will never ask for your seed phrase.`;
    try {
      const response = await sendXEnvelope(e.xId, text);
      const result = (await response.json()) as {
        data?: { dm_event_id?: string };
      };
      await ArchitectEnvelope.updateOne(
        { _id: e._id },
        {
          $set: {
            deliveryState: response.ok ? "sent" : "failed",
            deliveryEventId: result.data?.dm_event_id,
          },
        },
      );
      if (!response.ok)
        return res.status(502).json({
          error:
            "X did not accept delivery. Share the private claim link instead.",
        });
      res.json({ sent: true });
    } catch {
      await ArchitectEnvelope.updateOne(
        { _id: e._id },
        { $set: { deliveryState: "uncertain" } },
      );
      res.status(502).json({
        error:
          "Delivery could not be confirmed. It will not be retried automatically; share the link if needed.",
      });
    }
  } catch (e) {
    next(e);
  }
});
router.get("/architects/envelopes/:id", async (req, res, next) => {
  try {
    const e = await ArchitectEnvelope.findOne({
      envelopeId: req.params.id,
      accessHash: hash(token(req)),
    });
    if (!e) return res.status(404).json({ error: "Envelope not found." });
    const chain = await read(e.envelopeId);
    res.json({
      envelopeId: e.envelopeId,
      handle: e.handle,
      message: e.message,
      gross: e.gross,
      funder: e.funder,
      state: chain[4],
      expiresAt: Number(chain[3]) * 1000,
    });
  } catch (e) {
    next(e);
  }
});
router.post("/architects/envelopes/:id/x", async (req, res, next) => {
  try {
    const e = await ArchitectEnvelope.findOne({
      envelopeId: req.params.id,
      accessHash: hash(token(req)),
    });
    if (!e) return res.status(404).json({ error: "Envelope not found." });
    const chain = await read(e.envelopeId);
    if (chain[4] !== 1 || chain[3] * 1000n <= BigInt(Date.now()))
      return res.status(409).json({ error: "This envelope is not claimable." });
    const wallet = await authenticate(req.body);
    const state = random(),
      browser = random(),
      verifier = random();
    await ArchitectAuth.create({
      tokenHash: hash(state),
      kind: "oauth",
      wallet,
      envelopeId: e.envelopeId,
      verifier,
      browserHash: hash(browser),
      expiresAt: new Date(Date.now() + 600000),
    });
    res.cookie("hf_x_state", browser, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600000,
      path: "/api/architects/x/callback",
    });
    const url = new URL("https://x.com/i/oauth2/authorize");
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: env.X_CLIENT_ID!,
      redirect_uri: env.X_CALLBACK_URL,
      scope: "tweet.read users.read",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(k, v);
    res.json({ url: url.toString() });
  } catch (e) {
    next(e);
  }
});
router.get("/architects/x/callback", async (req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const browser =
      (req.headers.cookie ?? "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("hf_x_state="))
        ?.slice(11) ?? "";
    const auth = await ArchitectAuth.findOneAndDelete({
      tokenHash: hash(String(req.query.state)),
      kind: "oauth",
      browserHash: hash(browser),
      expiresAt: { $gt: new Date() },
    });
    res.clearCookie("hf_x_state", { path: "/api/architects/x/callback" });
    if (!auth || typeof req.query.code !== "string")
      throw new Error("X sign-in expired or cancelled.");
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: req.query.code,
      redirect_uri: env.X_CALLBACK_URL,
      code_verifier: auth.verifier!,
      client_id: env.X_CLIENT_ID!,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (env.X_CLIENT_SECRET)
      headers.Authorization = `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString("base64")}`;
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const body = (await response.json()) as { access_token?: string };
    if (!response.ok || !body.access_token)
      throw new Error("X token exchange failed.");
    const user = await xRequest("users/me", body.access_token);
    const e = await ArchitectEnvelope.findOne({ envelopeId: auth.envelopeId });
    if (!e || user.id !== e.xId)
      throw new Error("Sign in with the X account this envelope was sent to.");
    const session = random();
    await ArchitectAuth.create({
      tokenHash: hash(session),
      kind: "claim",
      wallet: auth.wallet,
      envelopeId: e.envelopeId,
      xId: user.id,
      expiresAt: new Date(Date.now() + 600000),
    });
    res.redirect(
      `${env.APP_BASE_URL}/?envelope=${e.envelopeId}#session=${session}`,
    );
  } catch {
    res.redirect(`${env.APP_BASE_URL}/?claimError=1`);
  }
});
router.post(
  "/architects/envelopes/:id/authorization",
  async (req, res, next) => {
    try {
      const auth = await ArchitectAuth.findOne({
        tokenHash: hash(token(req)),
        kind: "claim",
        envelopeId: req.params.id,
        expiresAt: { $gt: new Date() },
      });
      if (!auth)
        return res.status(401).json({ error: "Verify your X account again." });
      const e = await ArchitectEnvelope.findOne({
        envelopeId: req.params.id,
        xId: auth.xId,
      });
      if (!e) return res.status(404).json({ error: "Envelope not found." });
      const chain = await read(e.envelopeId);
      if (
        chain[4] !== 1 ||
        chain[1] !== e.xIdentity ||
        chain[2].toString() !== e.gross ||
        chain[0].toLowerCase() !== e.funder ||
        chain[3] * 1000n <= BigInt(Date.now())
      )
        return res
          .status(409)
          .json({ error: "Envelope is expired or no longer claimable." });
      const deadline = BigInt(
        Math.min(Math.floor(Date.now() / 1000) + 300, Number(chain[3]) - 1),
      );
      const signer = privateKeyToAccount(env.ARCHITECT_SIGNER_KEY as Hex);
      const signature = await signer.signTypedData({
        domain: {
          name: "HopfastArchitectEscrow",
          version: "1",
          chainId: env.ARCHITECT_CHAIN_ID,
          verifyingContract: address(),
        },
        types: {
          Claim: [
            { name: "envelopeId", type: "bytes32" },
            { name: "recipient", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Claim",
        message: {
          envelopeId: e.envelopeId as Hex,
          recipient: auth.wallet as Address,
          deadline,
        },
      });
      res.json({
        recipient: auth.wallet,
        deadline: deadline.toString(),
        signature,
      });
    } catch (e) {
      next(e);
    }
  },
);
router.use(
  (
    error: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    _next: import("express").NextFunction,
  ) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: "Please check the envelope details." });
    // Do not log OAuth credentials, private links or request bodies.
    res.status(400).json({
      error:
        error instanceof Error &&
        /^(Wallet |X verification)/.test(error.message)
          ? error.message
          : "The envelope action could not be completed. Please try again.",
    });
  },
);
export default router;
