import { NextResponse } from "next/server";
import crypto from "crypto";
import { accountsUrl, ssoConfigured } from "@/lib/entitlement";
import { ACCOUNT_STATE_COOKIE, STATE_COOKIE_OPTS } from "@/lib/account-session";

export const dynamic = "force-dynamic";

// GET /api/auth/boko — start the sign-in round trip to boko.com.au.
export async function GET(request) {
  if (!ssoConfigured()) {
    return NextResponse.json(
      { error: "Membership sign-in isn't configured on this deployment." },
      { status: 501 }
    );
  }

  const origin = new URL(request.url).origin;
  const state = crypto.randomBytes(16).toString("hex");
  const redirect = `${origin}/api/auth/boko/callback`;

  const target = new URL(accountsUrl() + "/");
  target.searchParams.set("boko_auth", "1");
  target.searchParams.set("redirect", redirect);
  target.searchParams.set("state", state);

  const res = NextResponse.redirect(target.toString());
  res.cookies.set(ACCOUNT_STATE_COOKIE, state, STATE_COOKIE_OPTS);
  return res;
}
