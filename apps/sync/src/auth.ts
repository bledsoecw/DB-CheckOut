/**
 * Google Workspace sign-in for the crew app, with zero runtime dependencies.
 *
 * Flow: the app gets a Google ID token from the Sign in with Google button,
 * POSTs it to /auth/google, the server verifies it against Google's public
 * keys and the allowed domain, then mints its own long-lived session token
 * (HS256 JWT) so the crew isn't re-prompted every hour. Protected routes
 * accept only that session token.
 */

import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";

export interface SessionUser {
  email: string;
  name: string;
}

const SESSION_ISSUER = "db-checkout";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // re-login monthly

const b64json = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function parseB64Json(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session tokens (minted and verified by this server)
// ---------------------------------------------------------------------------

function sessionSignature(secret: string, signingInput: string): Buffer {
  return createHmac("sha256", secret).update(signingInput).digest();
}

export function mintSession(secret: string, user: SessionUser, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64json({ alg: "HS256", typ: "JWT" });
  const payload = b64json({
    iss: SESSION_ISSUER,
    sub: user.email,
    name: user.name,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  });
  const signature = sessionSignature(secret, `${header}.${payload}`).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Returns the signed-in user, or null for anything invalid or expired. */
export function verifySession(secret: string, token: string, nowMs = Date.now()): SessionUser | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !secret) return null;
  const expected = sessionSignature(secret, `${parts[0]}.${parts[1]}`);
  const actual = Buffer.from(parts[2], "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const payload = parseB64Json(parts[1]);
  if (!payload || payload["iss"] !== SESSION_ISSUER) return null;
  if (typeof payload["exp"] !== "number" || payload["exp"] * 1000 <= nowMs) return null;
  const email = payload["sub"];
  if (typeof email !== "string" || !email) return null;
  return { email, name: typeof payload["name"] === "string" ? payload["name"] : email };
}

// ---------------------------------------------------------------------------
// Google ID token verification (RS256 against Google's published JWKS)
// ---------------------------------------------------------------------------

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid?: string;
  kty?: string;
  [key: string]: unknown;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function googleKeys(fetchImpl: typeof fetch, forceRefresh: boolean): Promise<Jwk[]> {
  const now = Date.now();
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: body.keys ?? [], fetchedAt: now };
  return jwksCache.keys;
}

/**
 * Verify a Google ID token's signature, issuer, audience and expiry, and
 * return its payload. Throws on anything invalid.
 */
export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<Record<string, unknown>> {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("Malformed credential");
  const header = parseB64Json(parts[0]);
  const payload = parseB64Json(parts[1]);
  if (!header || !payload) throw new Error("Malformed credential");
  if (header["alg"] !== "RS256") throw new Error("Unexpected algorithm");

  const kid = header["kid"];
  let keys = await googleKeys(fetchImpl, false);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    keys = await googleKeys(fetchImpl, true); // key rotation
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error("Unknown signing key");

  const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
  const ok = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new Error("Bad signature");

  if (!GOOGLE_ISSUERS.has(String(payload["iss"]))) throw new Error("Bad issuer");
  if (payload["aud"] !== clientId) throw new Error("Bad audience");
  if (typeof payload["exp"] !== "number" || payload["exp"] * 1000 <= nowMs) {
    throw new Error("Credential expired");
  }
  return payload;
}

/**
 * Decide whether a verified Google identity may use the app: a verified
 * email on the company Workspace domain, or an explicitly allowed address
 * (e.g. an owner's personal account). Throws when not allowed.
 */
export function assertAllowedIdentity(
  payload: Record<string, unknown>,
  workspaceDomain: string,
  allowedEmails: string[],
): SessionUser {
  const email = String(payload["email"] ?? "").toLowerCase();
  if (!email || payload["email_verified"] !== true) throw new Error("Email not verified");
  const onDomain =
    workspaceDomain.length > 0 &&
    (payload["hd"] === workspaceDomain || email.endsWith(`@${workspaceDomain}`));
  const allowListed = allowedEmails.includes(email);
  if (!onDomain && !allowListed) throw new Error(`Account not allowed: ${email}`);
  const name = typeof payload["name"] === "string" && payload["name"] ? payload["name"] : email;
  return { email, name };
}
