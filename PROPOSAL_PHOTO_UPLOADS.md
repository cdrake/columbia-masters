# Proposal: Volunteer Photo Uploads via Cloudflare Images

Let club volunteers upload gallery photos from their phones, without git, a developer,
or a redeploy-per-photo. This is the first paid service in the stack; this doc records
what we're buying, why, and how the site will use it.

## The problem

Today every gallery photo lives in git (`tenants/<slug>/public/gallery/<event>/`) and
gets to the site via: developer runs `hatch run gallery-add`, drops files into the
folder, runs `hatch run gallery-index`, commits, pushes, waits for a Pages build.

- Only a developer can add photos. Volunteers at a meet can't contribute.
- Binary blobs bloat the repo forever (already ~30 images checked in).
- Multi-tenant makes both worse: every club's photos through one person's git workflow.

## What we're buying

**Cloudflare Images** (paid tier on the existing Cloudflare account — the same account
that hosts the Pages projects and DNS). Pricing is usage-based with no base fee, billed
in increments:

| Line item | Price | Our expected usage |
|---|---|---|
| Storage | $5 / 100,000 images / month | a few thousand photos → first increment |
| Delivery | $1 / 100,000 images delivered / month | small-club traffic → first increment |
| Transformations | first 5,000/month free, then $0.50/1,000 | $0 — only applies to images *not* stored in Images |

**Expected bill: ~$5–6/month flat**, and it covers **all tenants** — Images is
account-level, so onboarding more clubs adds photos, not subscriptions. We would need
100,000+ stored photos before the bill moves.

What the $5 buys beyond raw storage:

- **Direct creator upload**: the API mints one-time upload URLs, so volunteers'
  browsers upload straight to Cloudflare. Our API token never leaves the server and
  no upload traffic transits the site.
- **Variants**: define `thumb` (~400px) and `public` (~1600px cap) once; every photo
  gets both automatically. No Python resizing pipeline, and phone photos stop shipping
  at 4MB each.
- **Metadata + EXIF stripping**: each image carries `{tenant, event, caption}` as
  metadata (our source of truth for which gallery it belongs to); GPS/EXIF is stripped
  on ingest — good default for photos of club members.
- **Serving**: images come off `imagedelivery.net` (Cloudflare CDN), not our Pages
  build, so the static site stays small.

## Alternatives considered

- **Cloudflare R2** (~$0.015/GB-month, zero egress): cheaper raw bytes and has presigned
  upload URLs, but no variants — we'd pay for transformations or build a resize worker,
  and we'd hand-roll the metadata/listing layer Images gives us. At our scale the price
  difference is a dollar or two; the code difference is real. R2 remains the right tool
  later for non-image assets (meet programs, PDFs).
- **Google Drive/Photos + Sheet links**: fits the existing volunteer workflow, but
  hotlinking is unreliable/against ToS, no variants, and dead links rot silently.
- **Status quo (git)**: free, but doesn't solve the actual problem (volunteers can't
  upload) and repo bloat compounds per tenant.

## Architecture

Photos in Cloudflare Images are tagged with metadata `{tenant, event, caption}`.
Git-tracked photos keep working unchanged; the two sources merge in the gallery index.

**Upload path** (new, this branch):

1. Volunteer opens `/upload` on their club's site — a Pages Function, gated by
   **Cloudflare Access** (free ≤50 users; allow-list of volunteer emails per club).
2. The page requests `POST /api/upload-url` (Pages Function) with `{event, caption}`.
3. The function calls the Images `direct_upload` API with our secret token + metadata,
   returns the one-time upload URL.
4. The browser posts the file straight to Cloudflare. Done — no deploy.

**Display path**:

- `gallery/index.json` photo entries gain an optional `url` field (absolute
  `imagedelivery.net` URL). The runtime prefers `url` over the git-relative `file`.
- A new pipeline step (`hatch run refresh` / `gallery-index`) lists hosted images from
  the Images API and merges them into each tenant's index, so uploads appear on the
  site at the next data refresh. (If we later want instant appearance, a small
  `/api/gallery` listing function can merge at runtime — not needed for v1.)

## Setup steps (Cloudflare dashboard, one-time)

1. **Subscribe to Images** on the account (Images → enable paid plan). — TODO
2. **Create variants**: `thumb` (fit 400×400) and `public` (fit 1600×1600, the
   default delivery variant). — TODO
3. **API token** scoped to `Cloudflare Images: Edit` on this account. — TODO
4. **Pages project env vars** (per tenant project, production + preview):
   `CF_ACCOUNT_ID`, `CF_IMAGES_API_TOKEN` (encrypted), `TENANT=<slug>`. — TODO
5. **Cloudflare Access application** covering `<domain>/upload` and `<domain>/api/*`,
   policy = allow-listed volunteer emails. — TODO

## Code plan (branch `photo-uploads`)

- [x] `web/functions/api/upload-url.ts` — Pages Function: validates the request, calls
  Images `direct_upload`, returns `{uploadURL, id}`.
- [x] `web/functions/upload.ts` — serves the volunteer upload page (event picker fed by
  the tenant's `gallery/index.json`, multi-file, per-file status).
- [x] Runtime: `GalleryEvent.photos[]` supports `url`; renderer prefers it.
- [ ] Pipeline: merge hosted images into `gallery/index.json` during
  `gallery-index`/`refresh` (needs the account + token to exist first).
- [ ] Docs: volunteer instructions; add upload keys to the Sheet training deck if we
  surface any of this in the Sheet.

## Open questions

- **Moderation**: uploads are Access-gated to trusted volunteers, so v1 ships without
  review. If that changes, Images metadata can carry `approved: false` and the sync
  step can filter.
- **Deletion/caption edits**: v1 = developer deletes via Cloudflare dashboard. A tiny
  admin page can come later if it's a real need.
- **Locations photos**: same mechanism extends to `locations/` galleries; out of scope
  for v1.
