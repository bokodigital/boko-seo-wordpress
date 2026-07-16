# Boko — WordPress / WooCommerce SEO Meta Studio

A Next.js app that generates **Google best-practice meta titles & descriptions** for your WordPress
**posts, pages, post categories**, and — if WooCommerce is active — **products and product categories**.
Review/edit each suggestion, then import it back to your site. Same Boko design as the Shopify version.

Meta is generated with **free, rule-based logic** (no AI key). It connects to your site with a
WordPress **Application Password**, and uses a tiny **companion plugin** so it works the same whether
your site runs **Yoast SEO**, **Rank Math**, or no SEO plugin at all.

---

## Why a companion plugin?

WordPress has no native "meta description" field — each SEO plugin stores it differently, and
WooCommerce products aren't on the standard REST API. The **Boko SEO Bridge** plugin gives the app one
clean, consistent API (`/wp-json/boko-seo/v1/...`) and maps meta to whichever SEO plugin you use.

---

## Setup

### 1. Install the companion plugin (one file)

- Take `wp-plugin/boko-seo-bridge.php` from this repo.
- Upload it to your site under `wp-content/plugins/boko-seo-bridge/boko-seo-bridge.php`
  (or zip the single file and use **Plugins → Add New → Upload Plugin**).
- Activate **Boko SEO Bridge** in WP admin → Plugins.

### 2. Create an Application Password

- WP admin → **Users → Profile** (your admin user) → scroll to **Application Passwords**.
- Name it `Boko SEO Studio` → **Add New Application Password**.
- Copy the generated password (looks like `xxxx xxxx xxxx xxxx`). It's shown once.

> Application Passwords require HTTPS and WordPress 5.6+. The user must have the
> `manage_options` capability (administrator).

### 3. Deploy the app (GitHub + Vercel)

1. Push this folder to a GitHub repo (or **Add file → Upload files** in the GitHub web UI).
2. https://vercel.com/new → **Import** the repo. Framework preset auto-detects **Next.js**.
3. Add one **Environment Variable**:
   - `SESSION_SECRET` = a long random string (`openssl rand -hex 32`)
   - `UPGRADE_URL` = *(optional)* where the free-tier **Upgrade** button links (defaults to `https://www.boko.com.au/upgrade`)
4. **Deploy.**

### 4. Connect

Open your Vercel URL → enter your **site URL**, **WordPress username**, and the **Application Password** →
**Connect site**. Your posts, pages, categories (and WooCommerce products/categories if active) load in.

---

## How it works

- **Connect**: site URL + username + application password (HTTP Basic). Stored only in an AES-256-GCM
  encrypted, http-only cookie — never exposed to the browser.
- **Read/Write meta**: via the bridge plugin's `/items` and `/update` endpoints, which map to:
  - **Yoast**: post meta `_yoast_wpseo_title` / `_yoast_wpseo_metadesc`; term meta via `wpseo_taxonomy_meta`.
  - **Rank Math**: post & term meta `rank_math_title` / `rank_math_description`.
  - **No SEO plugin**: stored in `_boko_seo_title` / `_boko_seo_desc` and rendered into `<head>` by the plugin.
- **Generate**: rule-based, free — title fitted to 50–60 chars, description to 150–160.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | yes | Encrypts the session cookie (`openssl rand -hex 32`) |

No AI key. No WooCommerce consumer keys (the bridge plugin reads products server-side).

## Supported content

Pages · Posts · Post categories · WooCommerce products* · WooCommerce product categories*
(*shown only when WooCommerce is active.)

## Notes & limits

- Lists up to 100 most-recently-modified items per type (adjust `LIMIT` in the plugin if needed).
- All in One SEO isn't directly mapped; on AIOSEO sites the app falls back to the standalone keys.
  Tell us if you need native AIOSEO support.

## Tech

Next.js 14 (App Router) · React 18 · WordPress REST (Application Passwords) · companion PHP plugin · Poppins via `next/font`.
---

## Free tier & upgrades (100-item limit)

The Studio is free for the **first 100 items across all content types combined**
(pages, posts/articles, categories, products, product categories/collections).
Once a connected site has **more than 100 items**, everything beyond the first 100
is **locked**: those cards show an **Upgrade** button instead of Generate/Import,
and "Generate all" / "Fix issues" / "Import all" only act on the free items.

The limit is enforced both in the UI and on the server (`/api/generate` and
`/api/import` return **HTTP 402** for locked items), so it can't be bypassed by
the buttons alone.

- **Where the count is decided:** `/api/items` tags each item `locked` in a fixed
  order and returns a `gate` object (`{ total, freeLimit, locked, lockedCount, upgradeUrl }`).
- **Change the free limit:** edit `FREE_LIMIT` in `lib/gate.js`.
- **Where "Upgrade" links to:** set the optional env var **`UPGRADE_URL`**
  (defaults to `https://www.boko.com.au/upgrade`). Point it at your Boko upgrade /
  checkout / enquiry page.
