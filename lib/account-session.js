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

/** Read { bokoToken, bokoCheckedAt } from the request, or null. */
export function getAccountSession(request) {
  const raw = request.cookies.get(ACCOUNT_COOKIE)?.value;
  if (!raw) return null;
  const s = decryptSession(raw);
  if (!s || !s.bokoToken) return null;
  return s;
}

/** Write the account cookie onto a NextResponse. */
export function setAccountCookie(res, token) {
  res.cookies.set(
    ACCOUNT_COOKIE,
    encryptSession({ bokoToken: token, bokoCheckedAt: Date.now() }),
    ACCOUNT_COOKIE_OPTS
  );
  return res;
}

export function clearAccountCookie(res) {
  res.cookies.set(ACCOUNT_COOKIE, "", { ...ACCOUNT_COOKIE_OPTS, maxAge: 0 });
  return res;
}
