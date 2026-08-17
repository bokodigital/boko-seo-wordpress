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
   - `UPGRADE_URL` = *(optional)* where the free-tier **Upgrade** button links (defaults to `https://boko.com.au/ai-tools/seo-meta-studio-by-boko/`)
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

## Image alt tags

The **Alt tags** tab scans the WordPress media library for images with **no alt text**
(`_wp_attachment_image_alt` empty or missing) and writes one for each.

- **How alt text is written:** free, rule-based — no AI key, no per-image cost. It uses the
  attachment's caption if there is one; otherwise it combines the parent post/product title with
  anything meaningful in the filename, falling back to a positional descriptor ("– alternate view",
  "– side view") for WooCommerce gallery images. Junk filenames (`IMG_4821.JPG`, `DSC_0001`, hashes,
  `-1024x768`, `-scaled`) are ignored rather than repeated back at the reader. Capped at 125 characters.
- **When it can't guess:** if there's nothing usable in the parent title, caption or filename, the
  card is flagged *"please describe this image yourself"* and left blank rather than saving filler.
- **Review before saving:** every suggestion is editable. Save one at a time, or **Save all
  suggestions** for everything visible on the tab.
- **Large media libraries:** images load 100 at a time with a **Scan more images** button.

### Requires Boko SEO Bridge v1.1.0

Alt text lives on media attachments, which the v1.0.0 bridge didn't expose. **Re-upload
`wp-plugin/boko-seo-bridge.php`** to `wp-content/plugins/boko-seo-bridge/` on every site using the
Studio. Nothing else changes — the meta title/description flow is untouched, and a site still on
v1.0.0 keeps working; only the Alt tags tab shows an "update the plugin" message.

New endpoints in v1.1.0:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/wp-json/boko-seo/v1/images` | GET | Paginated list of image attachments with no alt text (`?offset=&limit=`) |
| `/wp-json/boko-seo/v1/alt` | POST | Save alt text for one attachment (`{ id, alt }`) |

Both require `manage_options`, same as the existing routes. `/ping` and `/items` now also return a
`version` field so the app can detect an out-of-date plugin.

---

## Free tier & upgrades (10-item limit)

The Studio is free for the **first 10 items across all content types combined**
(pages, posts/articles, categories, products, product categories/collections).
Once a connected site has **more than 10 items**, everything beyond the first 10
is **locked**: those cards show an **Upgrade** button instead of Generate/Import,
and "Generate all" / "Fix issues" / "Import all" only act on the free items.

The limit is enforced both in the UI and on the server (`/api/generate`,
`/api/import` and `/api/alt` return **HTTP 402** for locked items), so it can't be
bypassed by the buttons alone.

Image alt tags have their **own separate allowance of 10 images** — a site has far
more images than pages, so counting them in the same pool would exhaust the free
tier instantly. `/api/images` carries the running count across pages via the
`loaded` query param, so the allowance isn't handed out again per page.

- **Where the count is decided:** `/api/items` (meta) and `/api/images` (alt tags)
  tag each item `locked` in a fixed order and return a `gate` object
  (`{ total, freeLimit, locked, lockedCount, upgradeUrl }`).
- **Change the free limit:** edit `FREE_LIMIT` in `lib/gate.js`.
- **Where "Upgrade" links to:** set the optional env var **`UPGRADE_URL`**
  (defaults to `https://boko.com.au/ai-tools/seo-meta-studio-by-boko/`). Point it at your Boko upgrade /
  checkout / enquiry page.
---

