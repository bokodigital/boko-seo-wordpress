import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const s = getSession(request);
  if (!s) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, site: s.site });
}
