# CLAUDE.md — reqFlow_exp

## What this project is
Darkstore requirement management app. Darkstore managers capture three types of requirements:
- **RESTOCK** — reorder products already in store
- **NEW_LABEL** — introduce a new brand/label
- **NEW_VARIETY** — add new variants of an existing brand

Core workflow:
- **NEW_LABEL / NEW_VARIETY** — Manager fills a form (images + voice note) → AI extracts structured data → **category confidence check** (if < 70%, chat prompts user to confirm/correct category with AI-suggested pills) → chat loop fills any remaining gaps → fuzzy match against brand/product catalog → saved to DB as OPEN.
- **RESTOCK** — Manager selects label via fuzzy-search bottom sheet → selects products from that brand's catalog (2×2 image grid, multi-select) → picks expected delivery date → optionally adds remarks via voice note → **no AI extraction** → saved to DB as OPEN with assignment resolved from catalog IDs.

## Stack
- **Next.js 16.2** App Router, TypeScript, Tailwind CSS v4
- **Supabase** for DB (PostgreSQL) + Storage (images)
- **Anthropic Claude** (haiku) + **Google Gemini** — swappable via `lib/ai.config.ts`
- **Deepgram** — Hindi voice transcription in-browser
- No auth — userId is a `BIGINT` passed as a URL param (e.g. `?userId=1`)
- Package manager: `npm`
- No `src/` dir; import alias `@/*`

## Dev commands
```bash
npm run dev    # Start dev server (localhost:3000)
npm run build  # Production build
npm run lint   # ESLint
```

## Key files
| File | Purpose |
|------|---------|
| `app/page.tsx` | Home: requirement list + "New Requirement" CTA |
| `app/requirements/[id]/page.tsx` | Detail: view/edit fields, comments, attachments |
| `app/components/RequirementForm.tsx` | Modal: type select, image upload, voice record. For RESTOCK: date picker, brand search bottom sheet, product selection bottom sheet (2×2 grid), remarks |
| `app/components/ExtractionReview.tsx` | AI review: edit JSON, category confidence check (pills), chat to fill gaps, fuzzy match |
| `lib/ai.config.ts` | Model choice + system prompts per requirement type; exports `CATEGORY_LIST` and `CATEGORY_NAMES` |
| `lib/ai.service.ts` | Extraction logic (Anthropic + Gemini) |
| `lib/supabase.ts` | `supabase` (browser/anon) + `supabaseAdmin` (service role) |
| `lib/extraction-validation.ts` | Required fields per type; drives chat prompts |
| `lib/requirement-type.map.ts` | UI label ↔ DB enum mapping |
| `supabase/schema.sql` | Full DB schema — run once in Supabase SQL editor |
| `lib/push.service.ts` | Web Push sender — `sendPushNotification(userId, payload)`; fetches subscription, sends, cleans up 410s |
| `app/components/PushPermissionPrompt.tsx` | First-visit banner (2s delay) prompting user to enable push notifications |
| `app/settings/page.tsx` | Settings page at `/settings?userId=<id>` — shows subscription status, device info, resubscribe |
| `worker/index.js` | Service worker push handler + notificationclick deep-link opener — compiled by next-pwa and injected via `importScripts` into `sw.js` |
| `app/api/upload/chat/route.ts` | Multipart file upload endpoint → `reqflow_attachments` Supabase bucket; validates type + 5 MB; returns public URL |
| `app/api/trading-products/route.ts` | POST — Proxies to Bijnis trading API (`/g/ss/retool/trading/trading-session-rm-variant-list`) with `Token-X` auth; returns `{ data: products[], resultCount }` |
| `app/api/requirements/[id]/suggest-products/route.ts` | POST — Upserts selected trading products into `mapped_products`; recalculates `products_suggested_count`; notifies creator via push |
| `app/requirements/[id]/suggest-products/page.tsx` | Suggest Products page — trading product grid with search, pagination, selection, sticky CTA |
| `app/api/requirements/[id]/reopen/route.ts` | POST — Creator reopens a closed requirement (`INCOMPLETE`, `CANNOT_BE_DONE`, `AUTO_CLOSED`). Clones the row, copies products + attachments, asks for new `expiry_date`, re-runs assignment, and starts at `OPEN` |
| `app/requirements/[id]/page.tsx` | `ReopenSheet` bottom-sheet component; `Re-Opened` badge on header when `parent_requirement_id` is set |

## API routes
| Route | Method | What it does |
|-------|--------|-------------|
| `/api/requirements` | GET | List requirements for a user |
| `/api/requirements` | POST | Create requirement + upload files + run AI extraction |
| `/api/requirements/assigned` | GET | Requirements assigned to a user (excludes DRAFT only; COMPLETED included); includes creator name + darkstore_name; also returns `comment_log` |
| `/api/requirements/[id]` | GET | Single requirement with products |
| `/api/requirements/[id]` | PATCH | Save final extraction → status OPEN |
| `/api/requirements/[id]/status` | PATCH | Role-gated status transition; validates role + transition, writes audit log |
| `/api/requirements/[id]/reopen` | POST | Creator reopens a closed requirement (`INCOMPLETE`, `CANNOT_BE_DONE`, `AUTO_CLOSED`). Clones the row, copies products + attachments, asks for new `expiry_date`, re-runs assignment, and starts at `OPEN` |
| `/api/requirements/[id]/assign` | PATCH | Reassign to a different bijnisBuyer; only current assignee (role=bijnisBuyer) can call; status must be OPEN or IN_PROCESS; ASSIGNMENT_CHANGE written via DB trigger; assigned_date unchanged |
| `/api/requirements/[id]/comment` | POST | Append to comment_log JSONB array; accepts optional `attachments: string[]` of Supabase public URLs; comment text is optional if attachments are present |
| `/api/requirements/[id]/suggest-products` | POST | Upserts selected trading products into `mapped_products`; recalculates `products_suggested_count`; notifies creator via push |
| `/api/trading-products` | POST | Proxies to Bijnis trading API (`/g/ss/retool/trading/trading-session-rm-variant-list`) with `Token-X` auth; returns `{ data: products[], resultCount }` |
| `/api/upload/chat` | POST | Upload a single file (multipart) to `reqflow_attachments` bucket; validates type + 5 MB limit; returns `{ url }` |
| `/api/user` | GET | User info from users table |
| `/api/users/bijnisBuyers` | GET | All users with role='bijnisBuyer' (id, name, phone); used by reassign bottom sheet |
| `/api/transcribe` | POST | Deepgram: audio → Hindi transcript |
| `/api/ai/fill-missing` | POST | AI fills missing fields from chat input; also supports `requestType: "category_suggestions"` to return top-5 ranked categories from `CATEGORY_LIST` |
| `/api/ai/re-extract` | POST | Re-run extraction with edited system prompt |
| `/api/brand-product/fuzzy-search` | POST | Trigram fuzzy search for brands/products; accepts optional `limit` param (default 5, max 20) |
| `/api/brands/[brandId]/products` | GET | Returns all distinct products for a brand from `brand_product_data` (deduplicated by `product_name`) |
| `/api/push/subscribe` | GET | Returns `{ subscribed, device_info, created_at }` for a userId |
| `/api/push/subscribe` | POST | Upserts push subscription for a user (one per user — replaces existing) |
| `/api/push/subscribe` | DELETE | Removes push subscription for a user |

## DB schema (key tables)
- **users** — `id BIGINT PK`, name, role, phone, darkstore_id, darkstore_name
- **categories** — `id UUID PK`, name
- **requirements** — `id UUID PK`, type (enum), status (default DRAFT), label_name, label_id, category_id, category_name (denorm), expiry_date, qty_required, remarks, attachments `JSONB [{url, file_name, storage_path}]`, comment_log `JSONB`, created_by (FK users), updated_by (FK users, nullable — set by every write path for audit), assigned_to_user_id, assigned_date, `products_suggested_count INT DEFAULT 0`, `parent_requirement_id UUID FK requirements(id)` — set when a requirement is cloned via Re-Open
- **requirement_products** — `id UUID PK`, requirement_id FK, product_id, product_name, notes. RESTOCK allows multiple rows; others max 1
- **mapped_products** — `id UUID PK`, productid, requirementid FK requirements(id) ON DELETE CASCADE, brandid, productname, variantid, landingprice, image_url, article_code, gender, availablestock, colorname, createdby FK users(id), createdat, updatedat. Unique index on `(requirementid, variantid)`. Stores trading products suggested by supply team against a requirement.
- **brand_product_data** — brand_name, brand_id, product_name, product_id, bijnis_buyer_id, bijnis_buyer_name, supply_tl_id, supply_tl_name, category_name, **image**, **article_code**. Has GiST trigram indexes for fuzzy search
- **ai_extractions** — requirement_id FK, extracted_data JSONB, model_used
- **status_update_log** — audit trail for status/assignment/field changes
- **push_subscriptions** — `id UUID PK`, `user_id BIGINT UNIQUE FK users`, `endpoint TEXT`, `p256dh TEXT`, `auth TEXT`, `device_info TEXT` (e.g. "Chrome on Android"), `created_at`. One row per user — upserted on re-subscribe.
- Triggers: `set_updated_at()` stamps `updated_at` BEFORE UPDATE; `log_requirement_changes()` writes to `status_update_log` AFTER UPDATE when `status` or `assigned_to_user_id` changes — reads `updated_by` as `changed_by` (NULL if not set)
- RPCs: `fuzzy_search_brands(query, limit)`, `fuzzy_search_products(query, limit)`

### comment_log entry shape
Each entry in `comment_log` is a JSONB object:
```json
{
  "userId": 123,
  "name": "Ravi Sharma",
  "comment": "text or empty string",
  "date": "2026-03-27T10:00:00.000Z",
  "attachments": ["https://...supabase.co/storage/v1/object/public/reqflow_attachments/123/1234567890-file.pdf"]
}
```
`attachments` is optional — omitted when there are no files. `comment` may be an empty string when only attachments are sent.

## Required env vars (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
SUPABASE_BUCKET=reqflow_images
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DEEPGRAM_API_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@reqflow.com
BIJNIS_TRADING_API_TOKEN=
```

## Chat Attachment System

Users can attach up to **3 files per message** in the chat window. Supported types: images (JPEG, PNG, WEBP, GIF), PDF, Excel (.xlsx/.xls), CSV. Max file size: **5 MB per file**.

### Storage
- Bucket: `reqflow_attachments` (must be created in Supabase and set to **public**)
- Storage path: `{userId}/{timestamp}-{sanitizedOriginalFilename}`
- The original filename is preserved (sanitized) in the path so it can be extracted for display without storing extra metadata

### Upload flow
1. User taps the paperclip icon → OS file/gallery picker opens
2. Files are validated client-side (type + size + count)
3. On send: images are compressed first (`compressChatImage` — max 800px, 400 KB, 65% JPEG quality)
4. Each file is POSTed individually to `/api/upload/chat` (server validates again, uploads via `supabaseAdmin`)
5. Collected URLs are included in the `POST /api/requirements/[id]/comment` payload as `attachments: string[]`

### Chat UI rendering
| Attachment type | In-chat display | On tap |
|----------------|----------------|--------|
| Image (jpg/png/webp/gif) | Thumbnail (max 200×200) | Fullscreen lightbox with pinch-to-zoom (1×–4×) |
| PDF / Excel / CSV | File icon + filename | Bottom sheet with Download / Cancel |
| Other | File icon + filename | Bottom sheet with Download / Cancel |

Key components (all in `app/requirements/[id]/page.tsx`):
- `compressChatImage` — client-side image compression before upload
- `ImageLightbox` — fullscreen overlay; pinch-to-zoom via touch distance tracking; Escape key closes
- `FileDownloadSheet` — bottom sheet modal; triggers `<a download>` on confirm
- `ChatAttachment` — renders one attachment (image thumbnail or file pill)
- `getChatFileName(url)` — strips timestamp prefix from storage path to recover display filename
- `getFileTypeLabel(url)` — returns "PDF" / "EXCEL" / "CSV" / "FILE" from URL extension

### Key constraints
- Attachment-only messages are allowed (empty `comment` string is valid if `attachments` is non-empty)
- Push notification body falls back to `"X sent N attachment(s)"` for attachment-only messages
- The attach button is disabled while sending or when 3 files are already selected

## Push Notification System

Web Push (VAPID) — free, no third-party service. Uses `web-push` npm package server-side.

### Key constraints
- **Service worker only active in production build** (`npm run build && npm start`). Push does NOT work in `npm run dev`.
- **One subscription per user** — `push_subscriptions` has `UNIQUE(user_id)`. New subscribe always replaces the old one.
- Works on Android (Chrome/Firefox) without home screen install. iOS requires home screen install.

### VAPID keys
Generated once via `npx web-push generate-vapid-keys`. Public key is `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client-safe). Private key is `VAPID_PRIVATE_KEY` (server-only). **Never regenerate** — existing browser subscriptions will break if keys change.

### Subscription flow
1. `PushPermissionPrompt` shows a banner 2s after first page load (skipped if already subscribed or permission denied)
2. On Allow: browser creates a push subscription → POST `/api/push/subscribe` → stored in `push_subscriptions`
3. Settings page (`/settings?userId=<id>`) shows device info + "Resubscribe this device" for manual management

### Notification triggers
| Event | File | Notifies |
|-------|------|---------|
| Final save (new assignment) | `app/api/requirements/[id]/route.ts` | Assignee |
| Status change | `app/api/requirements/[id]/status/route.ts` | Creator (when assignee acts) or Assignee (when creator acts) |
| Reassignment | `app/api/requirements/[id]/assign/route.ts` | New assignee |
| Products suggested | `app/api/requirements/[id]/suggest-products/route.ts` | Creator |

All notifications are fire-and-forget (IIFE async) — failures never affect the API response.

### Service worker push handler
`worker/index.js` — next-pwa compiles this directory (default `customWorkerSrc`) and injects the output via `importScripts` into the generated `sw.js`. Handles `push` event (shows notification) and `notificationclick` event (opens deep link to requirement).

**Important:** `customWorkerSrc` expects a **directory** containing `index.js` or `index.ts`, not a filename. A file placed directly in `public/` is only precached as a static asset and never executed as SW code.

### Resubscribe behaviour
"Resubscribe this device" in Settings first calls `existing.unsubscribe()` on the current browser subscription before re-subscribing. This forces the browser to generate a new endpoint — without this, the browser returns the cached subscription and the DB upsert sees no change (so `created_at` stays stale).

---

## UI conventions
- Mobile-first, `max-w-md` centered layout
- `rounded-2xl` cards, `bg-blue-600` primary CTA
- Bottom-sheet modals with slide-up animation
- Pill buttons for fuzzy match selection (green = all options; selected has tick icon)
- `Re-Opened` badge: orange pill (`bg-orange-100 text-orange-700`) on home cards and detail header when `parent_requirement_id` is set

## Architecture notes
- AI extraction returns a JSON blob; `ExtractionReview` drives a state machine: `extraction → [category-correction chat] → [missing-fields chat] → fuzzy-match → success`. The category step is skipped if `confidence.category_name ≥ 0.9` and `category_name` is non-null.
- If extraction is valid and has exact brand/product matches, the fuzzy-match view is skipped entirely
- `buildMergedExtraction()` in ExtractionReview merges selected fuzzy picks back into the extraction before saving
- Supabase anon key is used in the browser; `SUPABASE_SERVICE_KEY` is server-only (in API routes via `supabaseAdmin`)
- Switching AI provider: change `provider` in `lib/ai.config.ts` — currently Anthropic

---

## Detailed Workflow & Rules

This section documents every step end-to-end. Reference a step number when describing changes.

---

### Step 1 — Form capture (`RequirementForm.tsx` → `POST /api/requirements`)

#### 1.1 RESTOCK (manual flow — no AI extraction)
1. Manager selects **"Restock"** type.
2. Picks **Expected Delivery Date** via date input (sets `expiry_date`).
3. Taps **"Select Label Name"** → opens `BrandSearchSheet` bottom sheet.
   - Types brand name, taps **Search** → POSTs to `/api/brand-product/fuzzy-search` with `limit: 10`.
   - Results show as a scrollable list; tapping a row selects the brand and closes the sheet.
4. Once a brand is selected, **"Select Products"** CTA is enabled.
   - Tapping it opens `ProductSelectionSheet` bottom sheet.
   - Fetches `GET /api/brands/{brandId}/products` — deduplicated by `product_name`, includes `image`, `article_code`, `category_name`.
   - Products render in a **2×2 card grid** with image, checkbox, product name, article code, and category.
   - Multi-select via tap; selected cards show a green ring + checkmark.
   - **Save** button at the bottom persists selections and closes the sheet.
5. Selected products appear as removable pill tags below the CTA.
6. Manager can optionally record a **voice note** — Deepgram transcribes Hindi and appends the transcript to the **Remarks** field (not Notes).
7. On **Submit Requirement**, the client POSTs to `/api/requirements`:
   - Creates a row in `requirements` with `status = DRAFT`.
   - Sends `products` JSON array and `productImages` JSON map (first image per product).
   - Server saves product image URLs to `attachments` JSONB with `storage_path: "product-image:{product_id}"`.
   - Immediately calls `PATCH /api/requirements/[id]` to finalize assignment and set `status = OPEN`.
   - No AI extraction. No `ExtractionReview` modal.

#### 1.2 NEW_LABEL / NEW_VARIETY (AI extraction flow)
1. Manager selects requirement **type** and **category**.
2. Manager optionally uploads images and/or records a voice note (Deepgram transcribes Hindi in-browser via `POST /api/transcribe`; result is pasted into the **Notes** field).
3. On submit, the client POSTs to `/api/requirements`:
   - Creates a row in `requirements` with `status = DRAFT`.
   - Uploads each image to Supabase Storage bucket (`reqflow_images`); stores `[{url, file_name, storage_path}]` in `attachments` JSONB.
   - Runs AI extraction (see Step 2) and saves the result to `ai_extractions`.
   - Returns `{ requirementId, extracted_data, model_used, aiError }` to the client.
4. Client opens `ExtractionReview` modal with the returned extraction.

---

### Step 2 — AI Extraction (`lib/ai.service.ts` + `lib/ai.config.ts`)

2.1 Provider is set in `AI_CONFIG.provider` (`lib/ai.config.ts`) — currently `"anthropic"` (haiku). Switch to `"gemini"` there to change models.
2.2 The system prompt is **type-specific** and built fresh each call (today's date is injected):
  - **NEW_LABEL** — extracts `label_name`, `category_name`, `expiry_date`, `qty_required`, `remarks`, `products[]` (max 1 representative product).
  - **NEW_VARIETY** — extracts `label_name`, `category_name`, `expiry_date`, `qty_required`, `remarks`, `products[]` (multiple variants allowed).
  - **RESTOCK** — no AI prompt. RESTOCK uses the manual flow (Step 1.1) without extraction.
2.3 AI also returns `confidence{}` (per-field 0–1 score) and `extraction_notes` — `confidence` is used for the category check threshold; `extraction_notes` is hidden from the UI.
2.4 AI must **never** output `label_id` or `product_id` — those are catalog IDs resolved only via fuzzy match (Step 4).
2.5 The user can edit the system prompt in the UI and click **Re-run** to re-extract with the same images/notes.

---

### Step 3 — Category confidence check + Validation & Chat loop (`lib/extraction-validation.ts` + `/api/ai/fill-missing`)

#### 3.0 Category confidence check (runs first, before validation)
When the user clicks **Done**, `ExtractionReview` first checks `confidence.category_name`:
- If `confidence.category_name < 0.9` **or** `category_name` is null → open chat view in "Confirm Details" mode (category sub-step):
  1. POSTs to `/api/ai/fill-missing` with `requestType: "category_suggestions"` — AI returns top-5 ranked categories from `CATEGORY_LIST` ordered by likelihood.
  2. Chat shows the AI's opening message (with current category + confidence %, or "couldn't determine") and renders the suggestions as blue pill buttons.
  3. User taps a pill (auto-accepted) or types freely.
  4. Free-text is first matched case-insensitively against `CATEGORY_NAMES` (client-side). If matched → accepted. If not → sent to `/api/ai/fill-missing` (normal `fill` mode) to resolve. If AI resolves to a valid category → accepted. If still unresolved → new suggestions are fetched and shown again.
  5. Once a valid category is confirmed, `categoryCheckDone = true` and flow continues to 3.1.
- If `confidence.category_name ≥ 0.9` and `category_name` is non-null → skip category check, proceed to 3.1.

The `categoryCheckDone` flag resets when **Re-run** is used, so a new extraction always re-evaluates category confidence.

#### 3.1 Field validation
`validateExtraction()` checks required fields by type:

| Type | Required fields |
|------|----------------|
| NEW_LABEL | `label_name`, `category_name`, `expiry_date`, `qty_required` |
| NEW_VARIETY | `expiry_date`, `qty_required` |
| RESTOCK | No AI validation — fields are captured manually in the form (Step 1.1) |

3.2 If **valid** → skip to Step 4 (fuzzy match check).
3.3 If **invalid** → chat view switches to "Confirm Details" mode (missing-fields sub-step). AI is given `currentExtraction` + `missingKeys` + the user's natural language reply → returns `updated_extraction` JSON.
3.4 After each chat turn the extraction is re-validated. If now valid → proceed to Step 4. If still missing → continue chat.

#### `/api/ai/fill-missing` — request modes
| `requestType` | Behaviour |
|---------------|-----------|
| `"fill"` (default) | Fills `missingKeys` from `userMessage`. Returns `{ updated_extraction, filled_fields }`. |
| `"category_suggestions"` | Ignores `userMessage`/`missingKeys`. Uses extraction context + `CATEGORY_LIST` to return `{ category_suggestions: string[] }` (top 5, ordered by confidence). |

---

### Step 4 — Fuzzy catalog match (`/api/brand-product/fuzzy-search` + `ExtractionReview` fuzzy-match view)

#### 4.1 Search call
Client POSTs `{ label_name, product_names[] }` to `/api/brand-product/fuzzy-search`.
Server calls two Supabase RPCs (pg_trgm GiST indexes, similarity threshold 0.15):
- `fuzzy_search_brands(query, limit=5)` — returns `brand_name, brand_id, supply_tl_id, supply_tl_name, score` (DISTINCT ON lower(brand_name), tiebreak: highest score).
- `fuzzy_search_products(query, limit=5)` — returns `product_name, product_id, brand_id, brand_name, bijnis_buyer_id, bijnis_buyer_name, score` (DISTINCT ON lower(product_name), tiebreak: highest score).

Both RPCs source buyer/TL IDs directly from `brand_product_data` — **no second query is done at save time**.

#### 4.2 Exact match detection
A result is "exact" if `lower(result_name) === lower(query)`. Exact matches are auto-applied; non-exact matches become suggestion pills.

#### 4.3 Auto-save path (no user input needed)
If **all** brands and products are either exact matches or have no suggestions → merge exact picks and save immediately (fuzzy-match view never shown).

#### 4.4 Fuzzy-match view (user picks)
Shown when at least one brand or product has suggestions but no exact match.
- **Input field** shows the current value (labeled "You entered"). It is editable only when "As typed" is selected.
- **Horizontal scroll pill row** below the input shows options:
  - First pill is always **"As typed"** — preserves the original query with no catalog ID.
  - Remaining pills are catalog suggestions (carry `brand_id`/`product_id` and buyer/TL IDs).
- **Tick icon** prefix appears on the selected pill. Selected pills use a slightly darker green (`bg-green-100`) instead of inverted colors.
- **Tap a catalog pill** → populates the input with that value, locks the input (read-only), and links the catalog ID.
- **Tap "As typed"** → reverts input to the original query, unlocks the input for editing, and clears the catalog ID.
- **Typing in the input** while "As typed" is selected automatically switches to typed mode and clears any linked catalog ID.
- **Product sections** are numbered: "Product #1", "Product #2", etc.
- **Confirm & Save** → calls `buildMergedExtraction()` then saves.
- No "Save as typed" secondary button — the user can achieve the same by keeping every section on "As typed".

#### 4.5 `buildMergedExtraction()` merge rules
- Overwrites `label_name` and `label_id` with the selected label pick (if any).
- Replaces each `product_name` / `product_id` in `products[]` with the selected product pick.
- **Label override from product**: if every selected product that has a `brand_id` shares the same `brand_id`, that `brand_id` and `brand_name` overwrite `label_id`/`label_name` (product-derived brand wins over separately matched label).
- If selected products have different `brand_id` values, the label match result stands.

---

### Step 5 — Final save (`PATCH /api/requirements/[id]`)

The PATCH payload sent by the client:
```
userId,              ← the manager's user ID (written to requirements.updated_by for audit trigger)
label_name, label_id, category_name, expiry_date, qty_required, remarks,
products[],          ← array of { product_name, product_id, notes }
bijnis_buyer_id,     ← from the matched product's fuzzy result (null if "as typed" or no product match)
supply_tl_id,        ← from the matched brand's fuzzy result (null if "as typed" or no label match)
extracted_data,      ← full AI JSON archived in ai_extractions
model_used
```

#### 5.1 Assignment rule engine (`resolveAssignee`) — runs first, before any DB write

`resolveAssignee` is async — priority order:

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Any product in `products[]` has a non-null `product_id` **AND** `bijnis_buyer_id` is a valid number | `assigned_to_user_id = bijnis_buyer_id` (as BIGINT) |
| 2 | No valid product match, but `label_id` is set **AND** `supply_tl_id` is a valid number | `assigned_to_user_id = supply_tl_id` (as BIGINT) |
| 3 | Neither product nor label matched, but `category_name` has a row in `category_buyer_defaults` | `assigned_to_user_id = category_buyer_defaults.user_id` |
| 4 | None of the above | `assigned_to_user_id = NULL` |

When an assignment is resolved, `assigned_date` is also set to `NOW()`.
`bijnis_buyer_id` and `supply_tl_id` are validated with `!isNaN(Number(id))` before casting to BIGINT, so non-numeric values from dirty catalog data are safely ignored.

**`category_buyer_defaults` table** — stores the category → default bijnisBuyer mapping used by priority 3:
- `category_name TEXT PRIMARY KEY` — matches values in `CATEGORY_LIST` exactly
- `user_id BIGINT NOT NULL REFERENCES users(id)` — the bijnisBuyer to assign
- One row per category (one-to-one). Categories without a row fall through to NULL.
- Seeded with 14 mappings: Boots, Crocks, Formals, Jeans, Loafers, Sandals, School Shoes, Shirts, Shorts, Slippers, Sneakers, Sports, T-Shirts, Track Pants.

#### 5.2 Requirement type correction (`resolveType`) — runs after `resolveAssignee`

The user-selected type is **overridden** based on catalog match results:

| Condition | Corrected type |
|-----------|----------------|
| User selected `RESTOCK` | `RESTOCK` (never auto-corrected) |
| Any product in `products[]` has a non-null `product_id` | `RESTOCK` |
| No product match, but `label_id` is set | `NEW_VARIETY` |
| Neither `product_id` nor `label_id` found | `NEW_LABEL` |

The corrected type is written to `requirements.type` in the UPDATE. The PATCH response always includes `corrected_type` in `data`. If the client detects `corrected_type !== original type`, it shows an amber info banner on the success screen (auto-dismisses after 4 s).

#### 5.3 DB writes (in order)
1. `UPDATE requirements` — sets all fields + `type` (corrected) + `status = OPEN` + `assigned_to_user_id` + `assigned_date`.
2. `DELETE + INSERT requirement_products` — replaces all product rows for the requirement.
3. `INSERT ai_extractions` — archives the full extracted JSON (non-fatal if this fails; **skipped for RESTOCK** since no AI extraction is run).

---

### `brand_product_data` catalog table — key columns

| Column | Type | Purpose |
|--------|------|---------|
| `brand_id` | TEXT | Catalog brand identifier; stored in `requirements.label_id` |
| `brand_name` | TEXT | Fuzzy-matched against `label_name` from extraction |
| `product_id` | TEXT | Catalog product identifier; stored in `requirement_products.product_id` |
| `product_name` | TEXT | Fuzzy-matched against extracted product names |
| `bijnis_buyer_id` | TEXT (numeric) | Buyer user ID — used as `assigned_to_user_id` when a product match is found |
| `bijnis_buyer_name` | TEXT | Buyer display name (informational) |
| `supply_tl_id` | TEXT (numeric) | Supply TL user ID — used as `assigned_to_user_id` when only a brand match is found |
| `supply_tl_name` | TEXT | Supply TL display name (informational) |
| `category_name` | TEXT | Product category (auto-derived for RESTOCK from selected products) |
| `image` | TEXT | Product image URL(s); comma-separated if multiple |
| `article_code` | TEXT | Product article code for display |

GiST trigram indexes: `idx_brand_trgm` on `brand_name`, `idx_product_trgm` on `product_name`.

---

### Step 6 — Status Update workflow (`PATCH /api/requirements/[id]/status`)

#### 6.1 Status values

| Status | Meaning |
|--------|---------|
| `DRAFT` | Created by form submit; awaiting AI extraction review |
| `OPEN` | Extraction finalized; waiting for assignee to act |
| `IN_PROCESS` | Assignee has started working |
| `REVIEW_FOR_COMPLETION` | Assignee finished; waiting for creator's review |
| `COMPLETED` | Creator accepted the work |
| `PARTIALLY_COMPLETE` | Creator accepted partial completion |
| `INCOMPLETE` | Creator rejected the work |
| `CANNOT_BE_DONE` | Assignee marked as impossible |
| `AUTO_CLOSED` | Auto-closed by system after 30 days of inactivity |

`DRAFT → OPEN` is automatic (happens during extraction finalization in Step 5 — not user-initiated).

#### 6.2b Re-Open transition (creator-only, not a state transition)

A creator can **re-open** a closed requirement from `INCOMPLETE`, `CANNOT_BE_DONE`, or `AUTO_CLOSED`. This is **not** a status transition on the original row — it creates a **clone** (see Step 6.5).

#### 6.2 Role-based transition rules

A user must be the **creator** (`created_by = userId`) or the **assignee** (`assigned_to_user_id = userId`) to trigger any transition. Both sets of allowed transitions are combined if a user holds both roles.

**Creator transitions** (only valid from `REVIEW_FOR_COMPLETION`):

| From | To |
|------|----|
| REVIEW_FOR_COMPLETION | COMPLETED |
| REVIEW_FOR_COMPLETION | PARTIALLY_COMPLETE |
| REVIEW_FOR_COMPLETION | INCOMPLETE |

**Assignee transitions:**

| From | To |
|------|----|
| OPEN | IN_PROCESS |
| OPEN | CANNOT_BE_DONE |
| IN_PROCESS | REVIEW_FOR_COMPLETION |
| IN_PROCESS | CANNOT_BE_DONE |

Terminal states (no further transitions): `COMPLETED`, `PARTIALLY_COMPLETE`, `INCOMPLETE`, `CANNOT_BE_DONE`, `AUTO_CLOSED`.

**Full transition diagram:**
```
DRAFT ──(auto)──► OPEN
                   │ (assignee)
                   ▼
              IN_PROCESS ──► CANNOT_BE_DONE
                   │ (assignee)                    (creator)
                   ▼                      INCOMPLETE ───┐
        REVIEW_FOR_COMPLETION  AUTO_CLOSED ────────────┼──► Re-Open (clone)
                   │ (creator)          CANNOT_BE_DONE ─┘
          ┌────────┼────────┐
          ▼        ▼        ▼
      COMPLETED  PARTIALLY  INCOMPLETE
                 _COMPLETE
```

#### 6.3 API contract (`PATCH /api/requirements/[id]/status`)

Request body:
```json
{ "userId": 123, "newStatus": "IN_PROCESS" }
```

Server-side validation (in order):
1. Fetch `status`, `created_by`, `assigned_to_user_id` for the requirement (404 if missing).
2. Determine `isCreator` and `isAssignee` from `userId`.
3. Check if `newStatus` is in the allowed set for the user's role(s) and current status — return **403** if not.
4. `UPDATE requirements SET status = newStatus, updated_by = userId` (triggers DB audit log).

#### 6.4 DB audit trail

Every status change fires the `log_requirement_changes()` trigger which inserts into `status_update_log`:
- `change_type = 'STATUS_CHANGE'`
- `old_value` / `new_value` — previous and new status as text
- `changed_by` — `updated_by` from the PATCH payload

#### 6.5 UI — `StatusUpdater` component (`app/requirements/[id]/page.tsx`)

- Rendered inside `CollapsibleOverview` at the top of the detail page.
- `getAllowedTransitions(currentStatus, userId, createdBy, assignedToUserId)` computes the allowed transitions client-side (mirrors server rules).
- Only renders buttons if `allowed.length > 0`; nothing shown to users with no valid transitions.
- Each button opens a `StatusUpdateDialog` (bottom-sheet confirmation modal) before calling the API.
- Status badge in the header is color-coded: gray (DRAFT), blue (OPEN), yellow (IN_PROCESS), purple (REVIEW_FOR_COMPLETION), green (COMPLETED), red (INCOMPLETE), orange (PARTIALLY_COMPLETE).

#### 6.6 Key files

| File | Role |
|------|------|
| `app/requirements/[id]/page.tsx` | `StatusUpdater`, `StatusUpdateDialog`, `getAllowedTransitions`, `STATUS_COLORS`, `STATUS_LABELS` |
| `app/api/requirements/[id]/status/route.ts` | `PATCH` handler; `CREATOR_TRANSITIONS`, `ASSIGNEE_TRANSITIONS` constants; permission + transition validation |

---

### Step 6.5 — Re-Open workflow (`POST /api/requirements/[id]/reopen`)

#### 6.5.1 Who can reopen
- Only the **creator** (`created_by = userId`).
- The original requirement must be in one of these terminal states: `INCOMPLETE`, `CANNOT_BE_DONE`, `AUTO_CLOSED`.

#### 6.5.2 What happens
1. Client opens a **bottom-sheet** (`ReopenSheet`) asking for a **new deadline** (`expiry_date`).
2. On confirm: `POST /api/requirements/[id]/reopen` with `{ userId, newExpiryDate }`.
3. Server **clones** the original requirement into a new row:
   - Copies `type`, `label_name`, `label_id`, `category_id`, `category_name`, `qty_required`, `expected_price`, `remarks`, `notes`, `attachments`
   - Sets `status = OPEN`, `comment_log = []`, `products_suggested_count = 0`
   - Sets `parent_requirement_id = original.id`
   - Sets `created_by = original.created_by`, `updated_by = null`
   - Uses the provided `newExpiryDate`
4. Server copies `requirement_products` rows to the new requirement.
5. Server re-runs `resolveAssignee` and `resolveType` (same logic as Step 5) on the cloned products.
6. Server writes a `STATUS_CHANGE` entry to `status_update_log` for the clone (`old_value: null, new_value: OPEN`).
7. Server sends push notification to the newly assigned buyer.
8. The **original requirement is untouched** — it stays in its closed state forever.

#### 6.5.3 UI indicators
- **Detail page header**: orange `Re-Opened` pill badge next to the status badge when `parent_requirement_id` is set.
- **Home page cards**: orange `Re-Opened` pill badge on both "by me" and "for me" cards.
- **Re-Open button**: green `bg-green-600` button inside `CollapsibleOverview`, visible only to the creator when the status is `INCOMPLETE`, `CANNOT_BE_DONE`, or `AUTO_CLOSED`.

#### 6.5.4 Key files
| File | Role |
|------|------|
| `app/requirements/[id]/page.tsx` | `ReopenSheet` bottom-sheet component; `Re-Opened` badge on header; `canReopen` logic in `CollapsibleOverview` |
| `app/api/requirements/[id]/reopen/route.ts` | `POST` handler; clone logic, re-runs `resolveAssignee`/`resolveType`, writes audit log, sends push |

---

### Step 7 — Reassign workflow (`PATCH /api/requirements/[id]/assign`)

#### 7.1 Permission rules
- Only the **current assignee** (`assigned_to_user_id = userId`) can trigger a reassignment.
- The current user's role must be `'bijnisBuyer'` (checked server-side).
- The requirement must be in status `OPEN` or `IN_PROCESS`.
- Self-assignment (`newAssigneeId = userId`) is rejected with 400.
- The new assignee must exist in the `users` table with role `'bijnisBuyer'`.

#### 7.2 DB write
- `UPDATE requirements SET assigned_to_user_id = newAssigneeId, updated_by = userId`
- `assigned_date` is **not** updated (original assignment date is preserved).
- The `log_requirement_changes()` DB trigger fires automatically and writes an `ASSIGNMENT_CHANGE` row to `status_update_log`.

#### 7.3 UI — `ReassignSheet` component (`app/requirements/[id]/page.tsx`)
- Rendered in `DetailContent` as a bottom-sheet modal (`rounded-t-2xl`, slide-up).
- Visible in `CollapsibleOverview` expanded section as a **"Change assignee"** link — only shown when:
  - `assigned_to_user_id === userId`
  - `userRole === 'bijnisBuyer'`
  - `status` is `OPEN` or `IN_PROCESS`
- Fetches `GET /api/users/bijnisBuyers` on open; shows skeleton loading state.
- Filters out the current assignee from the list (no self-assignment).
- Name search filters the list client-side.
- Each list item shows buyer name + phone number.
- On successful reassignment: closes sheet, updates `req.assigned_to_user_id` and `assignedUser` in local state, shows a `Toast` (`"Reassigned to <name>"`).
- Toast auto-dismisses after 3 seconds.

#### 7.4 Key files
| File | Role |
|------|------|
| `app/requirements/[id]/page.tsx` | `ReassignSheet`, `Toast` components; `CollapsibleOverview` reassign trigger; `handleReassignSuccess` |
| `app/api/requirements/[id]/assign/route.ts` | `PATCH` handler; permission + validation logic |
| `app/api/users/bijnisBuyers/route.ts` | `GET` handler; returns all bijnisBuyer users |

---

### Step 8 — Home page filter pills (`app/page.tsx`)

The home page has two tabs: **Requirements by me** (`byMe`) and **Req for me** (`forMe`). Each tab has its own set of named filter pills. Switching tabs resets the active filter to **All Open**.

Filter state is a `FilterKey` string (not a raw status value). Filtering logic lives in `displayedRequirements` useMemo.

#### 8.1 "Requirements by me" filters

| Filter | Label | Statuses / Logic |
|--------|-------|-----------------|
| `all_open` | All Open | DRAFT, OPEN, IN_PROCESS, REVIEW_FOR_COMPLETION |
| `action_pending` | Action Pending | REVIEW_FOR_COMPLETION always; plus OPEN/IN_PROCESS only when `comment_log` is non-empty and the last comment's `userId ≠ currentUserId` |
| `closed` | Closed | COMPLETED, INCOMPLETE, PARTIALLY_COMPLETE, CANNOT_BE_DONE |

**Action Pending detail:** For OPEN/IN_PROCESS requirements, the condition is: at least one comment exists AND the last entry in `comment_log[]` has `userId !== currentUserId`. Requirements with an empty `comment_log` are excluded from this filter even if their status is OPEN or IN_PROCESS.

#### 8.2 "Req for me" filters

| Filter | Label | Statuses |
|--------|-------|---------|
| `all_open` | All Open | OPEN, IN_PROCESS |
| `follow_up` | Follow Up | REVIEW_FOR_COMPLETION (assignee tracking items they've submitted, awaiting creator closure) |
| `closed` | Closed | COMPLETED, INCOMPLETE, PARTIALLY_COMPLETE, CANNOT_BE_DONE |

#### 8.3 Data requirements
- Both `GET /api/requirements` (byMe) and `GET /api/requirements/assigned` (forMe) now return `comment_log` in the select.
- `GET /api/requirements/assigned` excludes DRAFT but **includes COMPLETED** (needed for the Closed filter).
- Tab badge counts exclude both DRAFT and COMPLETED regardless.

#### 8.4 Key constants (`app/page.tsx`)
- `BY_ME_FILTERS` / `FOR_ME_FILTERS` — ordered filter definitions `{ key, label }[]`
- `BY_ME_STATUS_SETS` / `FOR_ME_STATUS_SETS` — `Record<FilterKey, Set<string>>` for simple status-based filters
- `action_pending` is handled with custom logic (not in `BY_ME_STATUS_SETS`)

---

### Step 9 — Suggest Products workflow (`app/requirements/[id]/suggest-products/page.tsx` + `POST /api/requirements/[id]/suggest-products`)

#### 9.1 Who can suggest
Any user with `role = 'bijnisBuyer'` sees the **"Suggest Products"** sticky button on the requirement detail page. The button navigates to `/requirements/[id]/suggest-products?userId=X`.

#### 9.2 Trading API fetch
On mount the page loads the requirement to get `category_name` and `created_by`, then POSTs to `/api/trading-products` with:
- `userId = created_by` (requirement creator's ID)
- `categoryName = requirement.category_name`
- `query = search phrase` (optional)
- `start`, `size = 20`

The proxy calls `https://api.bijnis.com/g/ss/retool/trading/trading-session-rm-variant-list` with `Token-X` header and returns `payload` array + `resultCount`.

#### 9.3 Product grid
- Two-column grid cards showing: image, checkbox, product name, color name, landing price, MRP, margin, remaining lots pill
- **Green pill** for in-stock products (`remainingLotInfo.text`)
- **Red pill** for sold out products (`text === "All Lots Sold"`)
- Sold-out products are greyed out (`opacity-50`) with disabled checkbox
- Pagination via infinite scroll (IntersectionObserver, `size = 20`)
- Search bar is sticky with debounced input + manual Search CTA

#### 9.4 Selection UX
- Tap card or checkbox to select/unselect
- **"Show X selected"** toggles a filtered view of only selected products
- In selected view: uncheck removes from selection, "Clear all" removes everything, "Back to results" returns to full list
- Selections are maintained across pagination (products already in `selectedMap` stay selected when new pages load)
- Existing mapped products are pre-selected on page load

#### 9.5 Save
Sticky bottom button **"Suggest X Products"** appears when `selectedMap.size > 0`. On click it POSTs to `/api/requirements/[id]/suggest-products` with the full selection array. Server:
1. Upserts each product into `mapped_products` (`ON CONFLICT (requirementid, variantid) DO UPDATE`)
2. Recalculates `products_suggested_count` on the requirement row
3. Sends push notification to creator: `"X products mapped for your requirement of $label_name$"`

#### 9.6 Display on detail page
A collapsible **"Suggested Products (X)"** section appears below Attachments on the requirement detail page, showing the same 2-column grid with image, name, color, landing price, and available stock pill. The home page requirement card shows a blue **"X suggested"** pill badge when `products_suggested_count > 0`.

---

## Known quirks
- Folder name `reqFlow_exp` has capitals — was scaffolded in `/tmp/reqflow-exp` then moved
- Stray `package-lock.json` at `/Users/bijnis/` causes a Next.js workspace root warning (harmless)
- `viewport` must use `export const viewport: Viewport` (not inside `metadata`) in Next.js 16
- No Supabase Auth — never add it without a larger refactor; userId from URL param is intentional for now
- Home page uses a `mounted` guard (`if (!mounted) return <HomeSkeleton />`) to prevent hydration mismatch — the server renders the skeleton (no URL params), client renders the real content after mount. The hydration warning in dev mode is a false positive; production is unaffected.
