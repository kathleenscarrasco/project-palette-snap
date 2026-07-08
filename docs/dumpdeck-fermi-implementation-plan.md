# FotoFairy Fermi Lessons 4-10 Implementation Plan

## Current Architecture

FotoFairy is organized around a React/TanStack app flow in `src/routes/app.tsx` and project routes in `src/routes/projects.tsx` and `src/routes/projects.$projectId.tsx`.

Image understanding lives behind `src/lib/dumpdeck/pipeline`. The pipeline is modular:

- Local stages: pixel analysis, image quality, people detection, photo classification, aesthetic scoring, CLIP embedding, and local photo scoring.
- Gemini stage: `gemini-understanding` combines scene, object, and face analysis into one server-side call.
- Post-processing: duplicate clustering, organization/events, metadata ranking, unified analysis object, metadata cache, and draft saving.

Gemini is called only through server endpoints in `src/server.ts`:

- `/api/dumpdeck/image-understanding`
- `/api/dumpdeck/scene-analysis`
- `/api/dumpdeck/object-detection`
- `/api/dumpdeck/face-analysis`
- `/api/dumpdeck/pipeline-config`

Supabase persistence exists for:

- `image_metadata`
- `image_objects`
- `image_embeddings`
- `image_duplicate_clusters`
- `image_rankings`
- `saved_projects`
- `dumpdeck_drafts`

RLS is enabled on these tables, with policies scoped by `auth.uid() = user_id`.

## Requirements Coverage

### 1. API / Gemini Integration

Current status: mostly implemented.

- Gemini API key is server-side only through `GEMINI_API_KEY`.
- Default model is `gemini-2.5-flash`.
- Combined image-understanding endpoint reduces separate scene/object/face calls.
- Logs include photo id/name, reason, retry count, HTTP status, Retry-After, provider error code/message/status, and rolling metrics.

Remaining work:

- Keep watching for any new `VITE_GEMINI_*` usage.
- Add log export or admin-only diagnostics if manual console inspection becomes too noisy.

### 2. Performance Pipeline

Current status: implemented in shape, needs production hardening.

- Uploads run local preprocessing first.
- Obvious exact duplicates and unusable images are skipped before Gemini.
- Gemini candidates are selected from likely finalists and uncertain cases.
- `DUMPDECK_MAX_GEMINI_PHOTOS` caps refinement.
- Successful Gemini metadata is cached in Supabase by user, fingerprint, and pipeline version.

Remaining work:

- Persist uploaded photo assets in Supabase Storage so cached analysis can restore full projects after reload.
- Tune candidate selection after real 100-200 photo sessions.
- Add an automated simulation harness for 20, 100, and 200 image batches.

### 3. Queue / Rate Limits

Current status: implemented in client queue.

- Default concurrency is 3.
- Concurrency drops to 1 on rate limit.
- Retry delays use exponential backoff and Retry-After when present.
- Retry status returns to the queue without deadlocking.
- Errors preserve real provider status/message instead of treating every failure as rate limit.

Remaining work:

- Move long-running refinement to a durable backend job queue when uploads become server-stored.
- Add automated tests for immediate 429, Retry-After, and retry exhaustion.

### 4. Upload + File Support

Current status: implemented for browser upload path.

- Uploader accepts JPG/JPEG, PNG, WEBP, HEIC/HEIF, and GIF.
- HEIC/HEIF is converted internally with `heic-to`, falling back to `heic2any`.
- User-facing upload progress is neutral, for example `7/30 photos uploaded...`.
- Technical conversion details stay in developer logs.

Remaining work:

- Validate more iPhone variants from real camera rolls.
- Decide whether animated GIFs should be flattened, rejected, or preview-only.

### 5. Auth + User-Owned Data

Current status: partially implemented.

- Projects, metadata, embeddings, rankings, and drafts use Supabase Auth user IDs.
- RLS policies are present and should not be disabled.
- Local dev auth has a local-only fallback path for testing.

Remaining work:

- Add Supabase Storage buckets and RLS policies for original/preview photo files.
- Connect each uploaded photo asset to `user_id` and `project_id`.
- Add integration tests or SQL checks for cross-user access denial.

### 6. Persistent Projects / Drafts

Current status: draft save exists, full reload persistence is incomplete.

- Final draft saves ordered IDs, rejected IDs, duplicate decisions, preferences, scores, and reasons.
- Supabase is used for signed-in users, with local fallback for dev.

Remaining work:

- Add a `project_photos` table and Storage paths so project uploads can reload after a browser refresh.
- Add draft load/resume UI that restores final order, removals/restores, captions, and preferences.
- Store generated captions or selected caption choice with the draft.

### 7. Event / Group Review

Current status: implemented.

- Event group thumbnails can be removed before continuing.
- Removed photos are excluded from the final cut.
- Removal reason is `removed by user during event review.`
- Duplicate detection logic is not changed.

Remaining work:

- Persist event-review removals in project drafts and reload them.

### 8. AI Cut / Scoring Improvements

Current status: implemented in current ranking pass, should be tuned with real data.

- Ranking uses metadata rather than raw image inspection.
- Face weight is reduced so non-people images can survive.
- Aesthetic scenery, detail, food/drink, architecture/object, and abstract-style images receive stronger scene/object/tag support.
- Cut reasons are cut-specific and no longer prefer `Keep:` reasoning in the removed-photo UI.
- Cut score components are logged for debugging.

Remaining work:

- Build a small evaluation set of real accepted/rejected FotoFairy sessions.
- Add thresholds for selected-vibe differences so random/aesthetic/travel sets diverge more predictably.

### 9. Loading / Analyzing UX

Current status: implemented.

- Normal users see clean progress and rotating status copy.
- Technical queue states are kept out of the UI.
- The fixed `Quick scan runs first...` subtitle is replaced by rotating copy.
- Bottom progress remains simple, such as `Quick scan complete - refining top photos...`.

Remaining work:

- Verify mobile text wrapping on long rotating lines.

### 10. Captions

Current status: implemented.

- Caption bank avoids awkward `frames` language.
- Categories are preserved.
- Copy is more natural for Instagram/photo dumps.

Remaining work:

- Save selected/generated captions to drafts.

### 11. Project / Start Screen

Current status: partially implemented.

- Copy distinguishes upload/add-replace from start/continue sorting.
- Start Sorting is disabled when no uploaded batch is known.
- Known upload count is shown from local/session state.

Remaining work:

- Replace local/session upload count with Supabase-backed project photo count.
- Show `refinement still running` from durable project analysis state.

### 12. Deployment / Security

Current status: mostly implemented.

- `.env.example` and README document `GEMINI_API_KEY`, `GEMINI_MODEL`, concurrency, and max Gemini photo cap.
- No Gemini key should be committed or exposed to frontend code.
- Detailed Gemini logs are server-side; frontend logs contain product/debug metadata only.

Remaining work:

- Add a CI check that fails on `VITE_GEMINI_API_KEY` or committed key-looking strings.
- Configure production secrets in the deployment provider, not in git.

## Phased Plan

### Phase 1: Stabilize Observability and UX

Goal: make current behavior understandable and avoid obvious user-facing confusion.

Scope:

- Server-side Gemini retry metrics.
- Neutral upload progress.
- Rotating analyzing copy.
- Cut-specific reasons and scoring debug logs.
- Project screen copy/gating.

Status: in progress.

### Phase 2: Durable Project Photo Persistence

Goal: projects survive refresh and cross-device return.

Scope:

- Add `project_photos` table with `user_id`, `project_id`, storage path, preview path, fingerprint, dimensions, mime type, status, and timestamps.
- Add Supabase Storage buckets/policies for originals and previews.
- Upload files to Storage after local preparation.
- Link metadata cache rows to project photos.
- Replace local/session project counts with Supabase counts.

### Phase 3: Resume / Draft Loading

Goal: users can leave and continue without losing state.

Scope:

- Load latest project draft on project open.
- Restore selected preferences, duplicate decisions, event removals, final order, removed/restored photos, and captions.
- Add explicit `Continue draft` state when saved output exists.

### Phase 4: Queue and Refinement Hardening

Goal: make 100-200 photo uploads reliable.

Scope:

- Add automated queue simulations for 20, 100, and 200 photos.
- Test rate-limit, Retry-After, and transient errors.
- Persist per-photo analysis status in Supabase.
- Consider backend job queue once photo files are server-side.

### Phase 5: Ranking Calibration

Goal: improve final cuts with real user sessions.

Scope:

- Build fixtures for aesthetic scenery, detail, food/drink, architecture, abstract, people, and duplicate-heavy sets.
- Tune weights with selected vibes.
- Add before/after score breakdown snapshots.

### Phase 6: Security and Deployment Gates

Goal: prevent regressions around auth, RLS, and secrets.

Scope:

- Add secret-scan script for Gemini key patterns and `VITE_GEMINI`.
- Add SQL/RLS verification docs or tests.
- Document production env setup per deployment target.

## Final Test Checklist

- Mixed JPG/PNG/HEIC upload.
- 20-photo upload.
- 100-photo simulated upload.
- Gemini request count stays reasonable.
- No duplicate Gemini calls except controlled retries.
- Event review removal works.
- AI cut reasons make sense.
- Aesthetic scenery/detail photos are not unfairly cut.
- Captions are natural.
- Project saves and reloads.
- Users only see their own projects.
- No secrets exposed in frontend code.
