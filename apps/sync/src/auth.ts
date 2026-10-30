/**
 * Who may be acted for.
 *
 * The crew reach this server only through DB Crew (`bledsoecw/db-crew-app`):
 * its Apps Script verifies the person's Google sign-in, checks their role and
 * DB Hub access, and calls here with the shared secret plus X-Acting-Email /
 * X-Acting-Name (see actingUser in routes.ts). This server's own Google
 * sign-in and its month-long session tokens belonged to the retired Expo app
 * and were removed on 30 Oct 2026 (DB Crew T2.29), so there is one door with
 * one set of rules. What is left here is the identity gate that door uses.
 */

export interface SessionUser {
  email: string;
  name: string;
}

/**
 * Decide whether an identity may be acted for: a verified email on the
 * company Workspace domain, or an explicitly allowed address (e.g. an
 * owner's personal account). Throws when not allowed.
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
