import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
type Tokens = { clientId: string; accessToken: string; refreshToken?: string };
let cached: Tokens | undefined;
let refreshInProgress: Promise<Tokens> | undefined;
async function tokens(): Promise<Tokens> {
  if (cached) return cached;
  try {
    const saved = JSON.parse(
      await fs.readFile(env.X_BOT_TOKEN_STORE_PATH, "utf8"),
    ) as Tokens;
    if (
      saved.clientId === env.X_CLIENT_ID &&
      typeof saved.accessToken === "string"
    )
      return (cached = saved);
  } catch {}
  if (!env.X_CLIENT_ID || !env.X_BOT_ACCESS_TOKEN)
    throw new Error("X delivery is not configured.");
  return (cached = {
    clientId: env.X_CLIENT_ID,
    accessToken: env.X_BOT_ACCESS_TOKEN,
    refreshToken: env.X_BOT_REFRESH_TOKEN,
  });
}
async function refresh(): Promise<Tokens> {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = (async () => {
    const previous = await tokens();
    if (!previous.refreshToken)
      throw new Error("X bot token needs reauthorization.");
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (env.X_CLIENT_SECRET)
      headers.Authorization = `Basic ${Buffer.from(`${previous.clientId}:${env.X_CLIENT_SECRET}`).toString("base64")}`;
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: previous.clientId,
        refresh_token: previous.refreshToken,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!response.ok || !body.access_token)
      throw new Error("X bot token refresh failed.");
    cached = {
      clientId: previous.clientId,
      accessToken: body.access_token,
      refreshToken: body.refresh_token || previous.refreshToken,
    };
    const file = env.X_BOT_TOKEN_STORE_PATH;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(cached), { mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, file);
    return cached;
  })();
  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = undefined;
  }
}
export async function sendXEnvelope(
  xId: string,
  text: string,
): Promise<Response> {
  const send = (token: string) =>
    fetch(`https://api.x.com/2/dm_conversations/with/${xId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    });
  let current = await tokens();
  let response = await send(current.accessToken);
  // A definite authentication rejection cannot have delivered the message.
  if (response.status === 401) {
    const latest = await tokens();
    current =
      latest.accessToken !== current.accessToken ? latest : await refresh();
    response = await send(current.accessToken);
  }
  return response;
}
