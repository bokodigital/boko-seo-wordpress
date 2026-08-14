import { NextResponse } from "next/server";
import crypto from "crypto";
import { verifyToken } from "@/lib/entitlement";
import {
  ACCOUNT_STATE_COOKIE,
  STATE_COOKIE_OPTS,
  setAccountCookie,
} from "@/lib/account-session";

export const dynamic = "force-dynamic";

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  if (x.length !== y.length || x.length === 0) return false;
  try {
    return crypto.timingSafeEqual(x, y);
  } catch (e) {
    return false;
  }
}

// GET /api/auth/boko/callback?boko_token=...&state=...
export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("boko_token") || "";
  const state = url.searchParams.get("state") || "";
  const expected = request.cookies.get(ACCOUNT_STATE_COOKIE)?.value || "";

  const fail = (reason) => {
    const res = NextResponse.redirect(`${url.origin}/?signin=${encodeURIComponent(reason)}`);
    res.cookies.set(ACCOUNT_STATE_COOKIE, "", { ...STATE_COOKIE_OPTS, maxAge: 0 });
    return res;
  };

  // CSRF: the state must match the one we set when starting the round trip.
  if (!safeEqual(state, expected)) return fail("state");
  if (!token) return fail("notoken");

  const payload = verifyToken(token);
  if (!payload) return fail("invalid");

  const res = NextResponse.redirect(`${url.origin}/?signin=ok`);
  res.cookies.set(ACCOUNT_STATE_COOKIE, "", { ...STATE_COOKIE_OPTS, maxAge: 0 });
  return setAccountCookie(res, token);
}
