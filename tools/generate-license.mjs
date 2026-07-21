#!/usr/bin/env node
// Boko licence-key generator (one-time unlock, keyed to a customer's domain).
//
// Run AFTER a customer completes their one-time purchase on Boko's Stripe.
// LICENSE_SECRET must be the SAME value set on the app's Vercel deployment.
//
//   LICENSE_SECRET=xxxxx node tools/generate-license.mjs <domain>
//
// Examples:
//   node tools/generate-license.mjs clientsite.com.au
//   node tools/generate-license.mjs their-store.myshopify.com
//
// Give the printed key to the customer; they paste it into the app's
// "Already purchased?" box and everything unlocks for that site/store only.
import crypto from "crypto";

function normalizeSubject(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

const secret = process.env.LICENSE_SECRET || "";
const domain = process.argv[2];

if (!secret) {
  console.error("ERROR: set LICENSE_SECRET (must match the app's Vercel env var).");
  process.exit(1);
}
if (!domain) {
  console.error("Usage: LICENSE_SECRET=... node tools/generate-license.mjs <domain>");
  process.exit(1);
}

const subject = normalizeSubject(domain);
const key = crypto
  .createHmac("sha256", secret)
  .update("boko-seo-v1:" + subject)
  .digest("base64url");

console.log("Domain:  " + subject);
console.log("Licence: " + key);
