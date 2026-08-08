import { NextResponse } from "next/server";
import { FREE_LIMIT, upgradeUrl } from "@/lib/gate";
import { getSession } from "@/lib/session";
import { wpPost } from "@/lib/wp";
import { ALT_MAX } from "@/lib/alt-text";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not connected to a site." }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, locked } = body || {};
  const alt = String((body && body.alt) || "").replace(/\s+/g, " ").trim();

  if (locked) {
    return NextResponse.json(
      {
        error: `Your free plan covers the first ${FREE_LIMIT} images. Upgrade with Boko to fix the rest.`,
        upgradeUrl: upgradeUrl(),
      },
      { status: 402 }
    );
  }
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  if (!alt) {
    return NextResponse.json({ error: "Alt text can't be empty." }, { status: 400 });
  }
  if (alt.length > ALT_MAX) {
    return NextResponse.json(
      { error: `Alt text must be ${ALT_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  try {
    await wpPost(session, "/alt", { id, alt });
    return NextResponse.json({ ok: true, alt });
  } catch (e) {
    if (e && e.status === 404) {
      return NextResponse.json(
        { error: "Update the Boko SEO Bridge plugin to v1.1.0 to save alt text." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e.message || String(e) }, { status: e.status || 500 });
  }
}
