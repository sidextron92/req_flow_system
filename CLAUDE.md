# CLAUDE.md — reqFlow_exp

## What this project is
Darkstore requirement management app. Darkstore managers capture three types of requirements:
- **RESTOCK** — reorder products already in store
- **NEW_LABEL** — introduce a new brand/label
- **NEW_VARIETY** — add new variants of an existing brand

Core workflow: Manager fills a form (images + voice note + category) → AI extracts structured data → chat loop fills any gaps → fuzzy match against brand/product catalog → saved to DB as OPEN.

## Stack
- **Next.js 16** App Router, TypeScript, Tailwind CSS v4
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
| `app/components/RequirementForm.tsx` | Modal: type select, image upload, voice record |
| `app/components/ExtractionReview.tsx` | AI review: edit JSON, chat to fill gaps, fuzzy match |
| `lib/ai.config.ts` | Model choice + system prompts per requirement type |
| `lib/ai.service.ts` | Extraction logic (Anthropic + Gemini) |
| `lib/supabase.ts` | `supabase` (browser/anon) + `supabaseAdmin` (service role) |
| `lib/extraction-validation.ts` | Required fields per type; drives chat prompts |
| `lib/requirement-type.map.ts` | UI label ↔ DB enum mapping |
| `supabase/schema.sql` | Full DB schema — run once in Supabase SQL editor |

## API routes
| Route | Method | What it does |
|-------|--------|-------------|
| `/api/requirements` | GET | List requirements for a user |
| `/api/requirements` | POST | Create requirement + upload files + run AI extraction |
| `/api/requirements/[id]` | GET | Single requirement with products |
| `/api/requirements/[id]` | PATCH | Save final extraction → status OPEN |
| `/api/requirements/[id]/comment` | POST | Append to comment_log JSONB array |
| `/api/categories` | GET | All categories |
| `/api/user` | GET | User info from users table |
| `/api/transcribe` | POST | Deepgram: audio → Hindi transcript |
| `/api/ai/fill-missing` | POST | AI fills missing fields from chat input |
| `/api/ai/re-extract` | POST | Re-run extraction with edited system prompt |
| `/api/brand-product/fuzzy-search` | POST | Trigram fuzzy search for brands/products |

## DB schema (key tables)
- **users** — `id BIGINT PK`, name, role, phone, darkstore_id, darkstore_name
- **categories** — `id UUID PK`, name
- **requirements** — `id UUID PK`, type (enum), status (default DRAFT), label_name, label_id, category_id, category_name (denorm), expiry_date, qty_required, remarks, attachments `JSONB [{url, file_name, storage_path}]`, comment_log `JSONB`, created_by (FK users), assigned_to_user_id, assigned_date
- **requirement_products** — `id UUID PK`, requirement_id FK, product_id, product_name, notes. RESTOCK allows multiple rows; others max 1
- **brand_product_data** — brand_name, brand_id, product_name, product_id. Has GiST trigram indexes for fuzzy search
- **ai_extractions** — requirement_id FK, extracted_data JSONB, model_used
- **status_update_log** — audit trail for status/assignment/field changes
- Trigger: `set_updated_at()` auto-fires on requirements UPDATE
- RPCs: `fuzzy_search_brands(query, limit)`, `fuzzy_search_products(query, limit)`

## Required env vars (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
SUPABASE_BUCKET=reqflow_images
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DEEPGRAM_API_KEY=
```

## UI conventions
- Mobile-first, `max-w-md` centered layout
- `rounded-2xl` cards, `bg-blue-600` primary CTA
- Bottom-sheet modals with slide-up animation
- Pill buttons for fuzzy match selection (blue = catalog suggestion, gray = as-typed)

## Architecture notes
- AI extraction returns a JSON blob; `ExtractionReview` drives a 4-step state machine: `extraction → chat → fuzzy-match → success`
- If extraction is valid and has exact brand/product matches, the fuzzy-match view is skipped entirely
- `buildMergedExtraction()` in ExtractionReview merges selected fuzzy picks back into the extraction before saving
- Supabase anon key is used in the browser; `SUPABASE_SERVICE_KEY` is server-only (in API routes via `supabaseAdmin`)
- Switching AI provider: change `provider` in `lib/ai.config.ts` — currently Anthropic

---

## Detailed Workflow & Rules

This section documents every step end-to-end. Reference a step number when describing changes.

---

### Step 1 — Form capture (`RequirementForm.tsx` → `POST /api/requirements`)

1.1 Manager selects requirement **type** (RESTOCK / NEW_LABEL / NEW_VARIETY) and **category**.
1.2 Manager optionally uploads images and/or records a voice note (Deepgram transcribes Hindi in-browser via `POST /api/transcribe`; result is pasted into the Notes field).
1.3 On submit, the client POSTs to `/api/requirements`:
  - Creates a row in `requirements` with `status = DRAFT`.
  - Uploads each image to Supabase Storage bucket (`reqflow_images`); stores `[{url, file_name, storage_path}]` in `attachments` JSONB.
  - Runs AI extraction (see Step 2) and saves the result to `ai_extractions`.
  - Returns `{ requirementId, extracted_data, model_used, aiError }` to the client.
1.4 Client opens `ExtractionReview` modal with the returned extraction.

---

### Step 2 — AI Extraction (`lib/ai.service.ts` + `lib/ai.config.ts`)

2.1 Provider is set in `AI_CONFIG.provider` (`lib/ai.config.ts`) — currently `"anthropic"` (haiku). Switch to `"gemini"` there to change models.
2.2 The system prompt is **type-specific** and built fresh each call (today's date is injected):
  - **RESTOCK** — extracts `label_name`, `category_name`, `expiry_date`, `remarks`, `products[]` (each product must have format `"BrandName NumericCode"`, e.g. `"ASIAN 010"`).
  - **NEW_LABEL** — extracts `label_name`, `category_name`, `expiry_date`, `qty_required`, `remarks`, `products[]` (max 1 representative product).
  - **NEW_VARIETY** — extracts `label_name`, `category_name`, `expiry_date`, `qty_required`, `remarks`, `products[]` (multiple variants allowed).
2.3 AI also returns `confidence{}` (per-field 0–1 score) and `extraction_notes` — shown in the review UI but not saved to the requirements row.
2.4 AI must **never** output `label_id` or `product_id` — those are catalog IDs resolved only via fuzzy match (Step 4).
2.5 The user can edit the system prompt in the UI and click **Re-run** to re-extract with the same images/notes.

---

### Step 3 — Validation & Chat loop (`lib/extraction-validation.ts` + `/api/ai/fill-missing`)

3.1 When the user clicks **Done**, `validateExtraction()` checks required fields by type:

| Type | Required fields |
|------|----------------|
| RESTOCK | `label_name`, `category_name`, `expiry_date`, `products` (≥1 with a non-empty `product_name`) |
| NEW_LABEL | `label_name`, `category_name`, `expiry_date`, `qty_required` |
| NEW_VARIETY | `expiry_date`, `qty_required` |

3.2 If **valid** → skip to Step 4 (fuzzy match check).
3.3 If **invalid** → open chat view. AI is given `currentExtraction` + `missingKeys` + the user's natural language reply → returns `updated_extraction` JSON.
3.4 After each chat turn the extraction is re-validated. If now valid → proceed to Step 4. If still missing → continue chat.

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
- **Blue pills** = catalog suggestions (carry `brand_id`/`product_id` and buyer/TL IDs).
- **Gray pill** = "as typed" (user's original input; carries no catalog ID or buyer/TL ID).
- User may edit the gray pill text in-place before selecting it.
- **Confirm** → calls `buildMergedExtraction()` then saves.
- **Skip** → saves without any catalog IDs (assignee will be null).

#### 4.5 `buildMergedExtraction()` merge rules
- Overwrites `label_name` and `label_id` with the selected label pick (if any).
- Replaces each `product_name` / `product_id` in `products[]` with the selected product pick.
- **Label override from product**: if every selected product that has a `brand_id` shares the same `brand_id`, that `brand_id` and `brand_name` overwrite `label_id`/`label_name` (product-derived brand wins over separately matched label).
- If selected products have different `brand_id` values, the label match result stands.

---

### Step 5 — Final save (`PATCH /api/requirements/[id]`)

The PATCH payload sent by the client:
```
label_name, label_id, category_name, expiry_date, qty_required, remarks,
products[],          ← array of { product_name, product_id, notes }
bijnis_buyer_id,     ← from the matched product's fuzzy result (null if "as typed" or no product match)
supply_tl_id,        ← from the matched brand's fuzzy result (null if "as typed" or no label match)
extracted_data,      ← full AI JSON archived in ai_extractions
model_used
```

#### 5.1 Assignment rule engine (`resolveAssignee`) — runs first, before any DB write

Priority order:

| Condition | Action |
|-----------|--------|
| Any product in `products[]` has a non-null `product_id` **AND** `bijnis_buyer_id` is a valid number | `assigned_to_user_id = bijnis_buyer_id` (as BIGINT) |
| No valid product match, but `label_id` is set **AND** `supply_tl_id` is a valid number | `assigned_to_user_id = supply_tl_id` (as BIGINT) |
| Neither condition met | `assigned_to_user_id = NULL` |

When an assignment is resolved, `assigned_date` is also set to `NOW()`.
`bijnis_buyer_id` and `supply_tl_id` are validated with `!isNaN(Number(id))` before casting to BIGINT, so non-numeric values from dirty catalog data are safely ignored.

#### 5.2 DB writes (in order)
1. `UPDATE requirements` — sets all fields + `status = OPEN` + `assigned_to_user_id` + `assigned_date`.
2. `DELETE + INSERT requirement_products` — replaces all product rows for the requirement.
3. `INSERT ai_extractions` — archives the full extracted JSON (non-fatal if this fails).

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

GiST trigram indexes: `idx_brand_trgm` on `brand_name`, `idx_product_trgm` on `product_name`.

---

## Known quirks
- Folder name `reqFlow_exp` has capitals — was scaffolded in `/tmp/reqflow-exp` then moved
- Stray `package-lock.json` at `/Users/bijnis/` causes a Next.js workspace root warning (harmless)
- `viewport` must use `export const viewport: Viewport` (not inside `metadata`) in Next.js 16
- No Supabase Auth — never add it without a larger refactor; userId from URL param is intentional for now
