import { NextResponse } from "next/server";
import {
  resolveEntitlement,
  ssoConfigured,
  FREE_ENTITLEMENT,
  accountsUrl,
} from "@/lib/entitlement";
import {
  getAccountSession,
  setAccountCookie,
  clearAccountCookie,
} from "@/lib/account-session";

export const dynamic = "force-dynamic";

// GET /api/account — who's signed in and what plan are they on?
export async function GET(request) {
  const account = getAccountSession(request);
  const { entitlement, token, changed } = await resolveEntitlement(account || {});

  const res = NextResponse.json({
    ssoAvailable: ssoConfigured(),
    accountsUrl: accountsUrl() || null,
    ...entitlement,
  });

  // Persist a rolling token, or clear it if the membership is gone.
  if (changed) {
    if (token) setAccountCookie(res, token);
    else clearAccountCookie(res);
  }
  return res;
}

// DELETE /api/account — sign out of the Boko membership (keeps the store connected).
export async function DELETE() {
  return clearAccountCookie(NextResponse.json({ ...FREE_ENTITLEMENT, signedIn: false }));
}
