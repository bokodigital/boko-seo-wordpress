// One-time unlock licence keys, verified statelessly (no database).
//
// A licence key is an HMAC-SHA256 signature bound to the connected site/store
// domain. After a customer pays (Boko Stripe), Boko issues a key for their
// domain with the generator in tools/generate-license.mjs. The app verifies the
// key against the domain the user is ACTUALLY connected to, so a key issued for
// one store can't be reused on another.
//
// Requires the LICENSE_SECRET env var (same value used by the generator). If it
// is unset, verification always fails — the gate stays closed, never open.
import crypto from "crypto";

// Reduce a site URL or shop domain to a stable identifier.
export function normalizeSubject(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function sign(subject) {
  const secret = process.env.LICENSE_SECRET || "";
  return crypto
    .createHmac("sha256", secret)
    .update("boko-seo-v1:" + normalizeSubject(subject))
    .digest("base64url");
}

// Issue a licence key for a site/store domain (used by Boko's generator).
export function issueLicense(subject) {
  return sign(subject);
}

// True only if `key` is the valid licence for `subject` AND LICENSE_SECRET is set.
export function verifyLicense(key, subject) {
  const secret = process.env.LICENSE_SECRET || "";
  if (!secret || !key) return false;
  const expected = sign(subject);
  const a = Buffer.from(String(key).trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}
