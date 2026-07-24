# evsi.store — Dishkin production changes (2026-07-24, per-serving nutrition)

## What changed

### Recipe generation prompt (`src/app/api/cookly/_shared.ts`)

- `nutrition` in the recipe JSON contract is now **mandatory** — the model may never omit it or return null.
- All four values (`calories` kcal, `protein`/`carbs`/`fat` grams) must be estimated **per one serving** (the whole recipe divided by `servings`).
- The change applies to every route that uses the shared shape (`generate`, `refine`) the moment this project is deployed — the prompt lives server-side, so no mobile app update is required.
- `callGemini` accepts optional per-call `{ temperature, maxOutputTokens }` overrides (backwards-compatible; existing routes are unaffected).

### New route: `POST /api/cookly/nutrition`

Batch per-serving nutrition estimation, built for the dishkin.com admin tool that recalculates the existing catalog (~60k recipes):

- Request: `{ items: [{ id, title, servings, ingredients: [{ name, amount }] }] }`, up to 20 items.
- Response: `{ ok: true, results: [{ id, calories, protein, carbs, fat } | { id, error }] }`, matched by echoed id with a positional fallback.
- One Gemini call covers the whole batch (system prompt amortized), the model chain starts with the configured flash-lite model, temperature is 0 and the output budget is capped — a full 60k-recipe pass is roughly 4,000 cheap calls.
- Auth, CORS and rate limiting are identical to the other cookly routes (`X-Client-Token` vs `COOKLY_CLIENT_TOKEN`). dishkin-web already sends this token for bulk generation, so **no new environment variables are needed** in either project.

### Note on `src/app/[locale]/layout.tsx`

The `Inter` font initialization line was normalized to `Inter({ subsets: ["latin", "cyrillic"] })`. If your current production line differs (e.g. only `["latin"]`), this is a strict superset and safe to deploy; feel free to keep your original line instead — nothing else in this file changed.

### Hotfix (same day): `bad_ai_response` on the nutrition route

The first cut truncated the model output on real-world batches (the output-token cap was too tight once long recipe ids were echoed in every result object), which surfaced as `{"error":"ai_error","detail":"{\"error\":\"bad_ai_response\"}"}` in the dishkin admin tool. Fixed in this build:

- Dishes are numbered with short positional aliases inside the prompt (real recipe ids are mapped back server-side; the API contract is unchanged), trimming both prompt and output tokens.
- The output budget is now generous (≈128 tokens/dish; billing is by actual tokens, so cost is unaffected) and `thinkingBudget: 0` is sent explicitly so reasoning tokens can never eat the output budget.
- Parsing is tolerant: markdown fences, a wrapper object around the array, numeric id echoes, and a truncated array (salvaged up to the last complete object — unfinished dishes stay unmarked and are retried on the next pass).
- `bad_ai_response` now includes the first 300 characters of the raw model output in `detail` for diagnostics.

## Deployment

No database migration, no schema change, no new secrets. Build and restart with the current production process.

Deploy **before** running the nutrition recalculation tool in the dishkin.com admin (the tool calls the new route). Order for the full rollout:

1. Deploy this project (evsi.store) — new generations immediately get mandatory per-serving nutrition.
2. Deploy dishkin.com.
3. Run "Пересчёт КБЖУ" in the dishkin.com admin to backfill the existing catalog.
