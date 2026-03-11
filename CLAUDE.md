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
| `/api/requirements/assigned` | GET | Requirements assigned to a user (excludes DRAFT/COMPLETED); includes creator name + darkstore_name |
| `/api/requirements/[id]` | GET | Single requirement with products |
| `/api/requirements/[id]` | PATCH | Save final extraction → status OPEN |
| `/api/requirements/[id]/status` | PATCH | Role-gated status transition; validates role + transition, writes audit log |
| `/api/requirements/[id]/assign` | PATCH | Reassign to a different bijnisBuyer; only current assignee (role=bijnisBuyer) can call; status must be OPEN or IN_PROCESS; ASSIGNMENT_CHANGE written via DB trigger; assigned_date unchanged |
| `/api/requirements/[id]/comment` | POST | Append to comment_log JSONB array |
| `/api/user` | GET | User info from users table |
| `/api/users/bijnisBuyers` | GET | All users with role='bijnisBuyer' (id, name, phone); used by reassign bottom sheet |
| `/api/transcribe` | POST | Deepgram: audio → Hindi transcript |
| `/api/ai/fill-missing` | POST | AI fills missing fields from chat input |
| `/api/ai/re-extract` | POST | Re-run extraction with edited system prompt |
| `/api/brand-product/fuzzy-search` | POST | Trigram fuzzy search for brands/products |

## DB schema (key tables)
- **users** — `id BIGINT PK`, name, role, phone, darkstore_id, darkstore_name
- **categories** — `id UUID PK`, name
- **requirements** — `id UUID PK`, type (enum), status (default DRAFT), label_name, label_id, category_id, category_name (denorm), expiry_date, qty_required, remarks, attachments `JSONB [{url, file_name, storage_path}]`, comment_log `JSONB`, created_by (FK users), updated_by (FK users, nullable — set by every write path for audit), assigned_to_user_id, assigned_date
- **requirement_products** — `id UUID PK`, requirement_id FK, product_id, product_name, notes. RESTOCK allows multiple rows; others max 1
- **brand_product_data** — brand_name, brand_id, product_name, product_id. Has GiST trigram indexes for fuzzy search
- **ai_extractions** — requirement_id FK, extracted_data JSONB, model_used
- **status_update_log** — audit trail for status/assignment/field changes
- Triggers: `set_updated_at()` stamps `updated_at` BEFORE UPDATE; `log_requirement_changes()` writes to `status_update_log` AFTER UPDATE when `status` or `assigned_to_user_id` changes — reads `updated_by` as `changed_by` (NULL if not set)
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
userId,              ← the manager's user ID (written to requirements.updated_by for audit trigger)
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

`DRAFT → OPEN` is automatic (happens during extraction finalization in Step 5 — not user-initiated).

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

Terminal states (no further transitions): `COMPLETED`, `PARTIALLY_COMPLETE`, `INCOMPLETE`, `CANNOT_BE_DONE`.

**Full transition diagram:**
```
DRAFT ──(auto)──► OPEN
                   │ (assignee)
                   ▼
              IN_PROCESS ──► CANNOT_BE_DONE
                   │ (assignee)
                   ▼
        REVIEW_FOR_COMPLETION
                   │ (creator)
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

## Known quirks
- Folder name `reqFlow_exp` has capitals — was scaffolded in `/tmp/reqflow-exp` then moved
- Stray `package-lock.json` at `/Users/bijnis/` causes a Next.js workspace root warning (harmless)
- `viewport` must use `export const viewport: Viewport` (not inside `metadata`) in Next.js 16
- No Supabase Auth — never add it without a larger refactor; userId from URL param is intentional for now
- Home page uses a `mounted` guard (`if (!mounted) return <HomeSkeleton />`) to prevent hydration mismatch — the server renders the skeleton (no URL params), client renders the real content after mount. The hydration warning in dev mode is a false positive; production is unaffected.
