// A second, independent cookie holding the signed Boko Accounts token.
//
// Kept separate from the store/site session on purpose: a member can sign in
// with their Boko membership before connecting any store, and disconnecting a
// store shouldn't sign them out of their account (or vice versa).

import { encryptSession, decryptSession } from "@/lib/session";

export const ACCOUNT_COOKIE = "boko_account";
export const ACCOUNT_STATE_COOKIE = "boko_account_state";

export const ACCOUNT_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 days; the plan itself is re-checked far more often
};

export const STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 600, // 10 minutes to complete the round trip
};

/** Read { bokoToken, bokoCheckedAt, site } from the request, or null. */
export function getAccountSession(request) {
  const raw = request.cookies.get(ACCOUNT_COOKIE)?.value;
  if (!raw) return null;
  const s = decryptSession(raw);
  if (!s || !s.bokoToken) return null;
  return s;
}

/**
 * Write the account cookie onto a NextResponse.
 *
 * `extra.site` carries the cached site-coverage record — which site this
 * browser is pointed at and whether the member's plan covers it. Callers that
 * are only refreshing the token must pass the existing record through, or the
 * next request re-checks coverage with boko.com.au for nothing.
 */
export function setAccountCookie(res, token, extra = {}) {
  const data = { bokoToken: token, bokoCheckedAt: Date.now() };
  if (extra && extra.site) data.site = extra.site;
  res.cookies.set(ACCOUNT_COOKIE, encryptSession(data), ACCOUNT_COOKIE_OPTS);
  return res;
}

/**
 * Persist whatever a gateContext() call learned. No-op unless it actually went
 * to WordPress, so ordinary cached requests don't rewrite the cookie.
 */
export function persistGate(res, ctx) {
  if (ctx && ctx.changed && ctx.token) {
    setAccountCookie(res, ctx.token, { site: ctx.coverage });
  }
  return res;
}

export function clearAccountCookie(res) {
  res.cookies.set(ACCOUNT_COOKIE, "", { ...ACCOUNT_COOKIE_OPTS, maxAge: 0 });
  return res;
}
