import { NextResponse } from "next/server";
import { encryptSession, SESSION_COOKIE } from "@/lib/session";
import { wpGet, normalizeSite } from "@/lib/wp";

export const dynamic = "force-dynamic";

// POST { site, username, password } -> validate against the bridge plugin, set session cookie.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const site = normalizeSite(body.site);
  const user = (body.username || "").trim();
  const pass = (body.password || "").trim();

  if (!site || !user || !pass) {
    return NextResponse.json(
      { error: "Site URL, username and application password are all required." },
      { status: 400 }
    );
  }

  const session = { site, user, pass };
  try {
    // /ping confirms credentials + that the bridge plugin is installed.
    const ping = await wpGet(session, "/ping");
    const res = NextResponse.json({
      connected: true,
      site,
      seo: ping.seo,
      woocommerce: ping.woocommerce,
    });
    res.cookies.set(SESSION_COOKIE, encryptSession(session), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: e.status || 500 });
  }
}
