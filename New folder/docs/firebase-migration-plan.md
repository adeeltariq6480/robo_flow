# Firebase Migration Plan — Label AI

Migration from **Supabase (Postgres + Storage)** to **Firebase (Auth + Firestore + Storage)** while keeping the existing frontend UI, routes, and user flows unchanged.

---

## 1. Current Architecture (Supabase)

| Layer | Technology | Notes |
|-------|------------|-------|
| Auth | None (service-role bypass) | `created_by` always `null` |
| Database | Supabase Postgres | `projects`, `classes`, `datasets`, `dataset_files`, `models`, `inference_jobs`, `inference_job_items` |
| Storage | Supabase buckets `datasets`, `models` | Browser direct upload via REST + anon key |
| Server | Next.js server actions + RSC pages | `createAdminClient()` everywhere |
| Worker | Python FastAPI + `supabase` SDK | Reads/writes same tables + storage |

---

## 2. Target Architecture (Firebase)

| Layer | Technology | Notes |
|-------|------------|-------|
| Auth | Firebase Auth | Login/register; roles in Firestore `users` |
| Database | Firestore | Collections per spec below |
| Storage | Firebase Storage | Folder structure per spec below |
| Server | Next.js + `firebase-admin` | Server actions call service layer |
| Client | `firebase` SDK | Auth, browser storage uploads |
| Worker | Python + `firebase-admin` | YOLO inference, job progress, exports |

---

## 3. Supabase Files to Remove

### Frontend / Next.js

| File | Action |
|------|--------|
| `src/lib/supabase/client.ts` | **Delete** — unused browser client |
| `src/lib/supabase/server.ts` | **Delete** — unused cookie client |
| `src/lib/supabase/admin.ts` | **Delete** — replaced by `src/lib/firebase/admin.ts` |
| `src/lib/supabase/middleware.ts` | **Delete** — replaced by `src/lib/firebase/middleware.ts` |
| `src/lib/upload/direct-storage.ts` | **Delete** — replaced by `src/lib/upload/firebase-storage.ts` |
| `src/lib/upload/xhr.ts` | **Delete** — unused |
| `src/app/api/projects/[id]/datasets/[datasetId]/upload/route.ts` | **Delete** — legacy upload |
| `src/app/api/projects/[id]/models/upload/route.ts` | **Delete** — legacy upload |
| `supabase/` (entire folder) | **Delete** after migration — schema, migrations, config |

### Python Worker

| File | Action |
|------|--------|
| `worker/app/services/supabase_client.py` | **Delete** — replaced by `firebase_client.py` |

### Dependencies

| Package | Action |
|---------|--------|
| `@supabase/ssr` | **Remove** from `package.json` |
| `@supabase/supabase-js` | **Remove** |
| `supabase` (CLI devDep) | **Remove** |
| `firebase` | **Add** — client SDK |
| `firebase-admin` | **Add** — server SDK |

---

## 4. Firebase Services Mapping

| Supabase | Firebase Replacement |
|----------|---------------------|
| Supabase Auth (unused) | **Firebase Auth** — email/password login & register |
| Postgres `projects` | Firestore `projects` |
| Postgres `classes` | `projects/{projectId}/classes` |
| Postgres `datasets` | `projects/{projectId}/datasets` |
| Postgres `dataset_files` | `projects/{projectId}/images` + `annotations` + `annotationObjects` |
| Postgres `models` | `projects/{projectId}/models` |
| Postgres `inference_jobs` | `projects/{projectId}/labellingJobs` + `modelTestRuns` |
| Postgres `inference_job_items` | Progress tracked on `labellingJobs`; test runs use `modelComparisonResults` |
| Storage `datasets` bucket | `projects/{projectId}/datasets/{datasetId}/images/` |
| Storage `models` bucket | `projects/{projectId}/models/` |
| Export (Next.js zip) | Worker `POST /api/export` → Storage `projects/{projectId}/exports/` |
| RLS / service role | **Firestore rules** + **Storage rules** + Admin SDK on server/worker |

---

## 5. Frontend Files to Change

### New files

```
src/lib/firebase/client.ts
src/lib/firebase/admin.ts
src/lib/firebase/config.ts
src/lib/firebase/paths.ts
src/lib/firebase/adapters.ts
src/lib/firebase/middleware.ts
src/lib/services/authService.ts
src/lib/services/projectService.ts
src/lib/services/classService.ts
src/lib/services/datasetService.ts
src/lib/services/modelService.ts
src/lib/services/annotationService.ts
src/lib/services/exportService.ts
src/lib/upload/firebase-storage.ts
src/lib/types/firestore.ts
src/app/(auth)/login/page.tsx
src/app/(auth)/register/page.tsx
src/components/auth/auth-form.tsx
firebase/firestore.rules
firebase/storage.rules
```

### Modified files

| File | Change |
|------|--------|
| `src/lib/env.ts` | Firebase env validation |
| `src/lib/types/database.ts` | Compatibility aliases from Firestore types |
| `src/lib/server/auth.ts` | Firebase session + `getProject()` |
| `src/middleware.ts` | Firebase auth cookie check |
| `src/lib/actions/*.ts` | Call Firebase services instead of Supabase |
| `src/lib/export/build.ts` | Firestore + Firebase Storage signed URLs |
| `src/app/api/.../export/route.ts` | Use export service |
| All RSC pages using `createAdminClient` | Use services |
| `src/components/*/upload-form.tsx` | Firebase Storage upload |
| `src/app/setup-error/page.tsx` | Firebase setup instructions |
| `.env.local.example` | Firebase vars |
| `package.json` | Swap dependencies |

---

## 6. Python Worker Files to Change

| File | Change |
|------|--------|
| `worker/app/services/firebase_client.py` | **New** — Admin SDK singleton |
| `worker/app/services/storage.py` | Firebase Storage download |
| `worker/app/services/firestore_repo.py` | **New** — CRUD for jobs, images, annotations |
| `worker/app/core/jobs.py` | Firestore `labellingJobs` / `modelTestRuns` |
| `worker/app/services/auto_label.py` | Firestore annotations + queue separation |
| `worker/app/services/test_run.py` | Firestore test runs + comparison results |
| `worker/app/services/model_compare.py` | Firestore comparison results |
| `worker/app/api/routes.py` | Add `/api/*` aliases; export endpoint |
| `worker/app/services/export.py` | **New** — YOLO/COCO/VOC/CSV export to Storage |
| `worker/app/config.py` | Firebase env vars |
| `worker/requirements.txt` | `firebase-admin` instead of `supabase` |
| `worker/.env.example` | Firebase credentials |

---

## 7. Firestore Collection Structure

### Top-level

```
users/{uid}
  - fullName, email, role, createdAt, updatedAt

projects/{projectId}
  - name, description, annotationType, createdBy, createdAt, updatedAt
```

### Project subcollections

```
projects/{projectId}/classes/{classId}
  - className, classIndex, color?, description?, createdAt, updatedAt

projects/{projectId}/datasets/{datasetId}
  - name, totalImages, description?, createdAt, updatedAt

projects/{projectId}/images/{imageId}
  - datasetId, fileName, storagePath, downloadUrl, mimeType?, fileSize?
  - width, height, status, queueType, createdAt, updatedAt

projects/{projectId}/models/{modelId}
  - modelName, modelVersion, modelType, storagePath, downloadUrl
  - classMapping, fileSize?, description?, createdAt, updatedAt

projects/{projectId}/modelTestRuns/{runId}
  - modelIds, testImageIds, confidenceThreshold, iouThreshold
  - imageSize, lowLabelThreshold, status, createdAt, updatedAt

projects/{projectId}/modelComparisonResults/{resultId}
  - testRunId, modelId, totalDetections, avgConfidence
  - detectionsPerImage, zeroLabelImages, lowLabelImages
  - classCoverage, duplicateOverlapRate, qualityScore, resultJson, createdAt

projects/{projectId}/labellingJobs/{jobId}
  - datasetId, modelId, modelIds?, confidenceThreshold, iouThreshold
  - imageSize, lowLabelThreshold, status, progress, progressMessage
  - totalItems, processedItems, result?, errorMessage?
  - createdAt, completedAt

projects/{projectId}/annotations/{annotationId}
  - imageId, jobId?, status, source, reviewStatus, reviewedAt?
  - autoLabeledAt?, createdAt, updatedAt

projects/{projectId}/annotationObjects/{objectId}
  - annotationId, imageId, classId, classIndex, className
  - xMin, yMin, xMax, yMax, confidence, source, createdAt, updatedAt

projects/{projectId}/reviewQueues/{queueId}
  - imageId, queueType, reason, createdAt

projects/{projectId}/exportJobs/{exportJobId}
  - exportFormat, status, storagePath, downloadUrl, createdAt, completedAt

projects/{projectId}/auditLogs/{logId}
  - userId, action, entityType, entityId, details, createdAt
```

### Legacy UI adapter

The existing UI expects `DatasetFile` with embedded `annotations[]`. The service layer joins `images` + `annotations` + `annotationObjects` into that shape — **no component changes required**.

### Queue types (`queueType` on images + `reviewQueues`)

| Queue | Condition |
|-------|-----------|
| `good` | Sufficient detections, confident labels |
| `no_label` | Zero detections |
| `low_label` | Detection count ≤ `lowLabelThreshold` |
| `low_confidence` | Any label below/near confidence threshold |
| `conflict` | Multi-model disagreement on class/count/location |
| `class_missing` | Expected classes missing or abnormal distribution |

---

## 8. Firebase Storage Folder Structure

```
projects/{projectId}/datasets/{datasetId}/images/{uuid}-{fileName}
projects/{projectId}/models/{uuid}-{fileName}
projects/{projectId}/labels/{datasetId}/{imageId}.txt
projects/{projectId}/exports/{exportJobId}.{zip|json}
projects/{projectId}/thumbnails/{imageId}.jpg
```

---

## 9. Firebase Auth & Role Management

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all projects |
| `annotator` | Create/edit annotations on assigned projects |
| `reviewer` | Review/approve/reject annotations |
| `viewer` | Read-only access |

**Flow:**

1. User registers → Firebase Auth creates account
2. Server action creates `users/{uid}` with default role `annotator`
3. First registered user can be promoted to `admin` manually in Firestore Console
4. Project `createdBy` links project ownership
5. Rules: admin OR `createdBy` OR role-based project membership (future: `projectMembers` subcollection)

**Session:** Client obtains ID token → server action sets `__session` httpOnly cookie → middleware checks presence → server verifies with Admin SDK.

---

## 10. Environment Variables

### Frontend `.env.local.example`

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_WORKER_API_URL=http://localhost:8000
WORKER_URL=http://localhost:8000
WORKER_API_KEY=dev-worker-key
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_SERVICE_ACCOUNT_JSON=
```

### Python worker `.env.example`

```env
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
WORKER_PORT=8000
WORKER_API_KEY=dev-worker-key
```

> **Never commit** service account JSON. Add `*firebase-adminsdk*.json` to `.gitignore`.

---

## 11. Security Rules

See `firebase/firestore.rules` and `firebase/storage.rules`.

**Principles:**

- `request.auth != null` required for all reads/writes
- Admin role (`users/{uid}.role == 'admin'`) has full access
- Project creator (`projects.createdBy == request.auth.uid`) has full project access
- Annotator: write annotations, read project data
- Reviewer: update `reviewStatus`, read all
- Viewer: read-only
- **Server actions and Python worker use Admin SDK** (bypass rules) — same pattern as current service-role key

---

## 12. Worker API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/test-run` | Test inference on sample images |
| `POST /api/auto-label` | Full dataset auto-labelling job |
| `GET /api/jobs/{jobId}` | Job status from Firestore |
| `POST /api/export` | Export approved labels to Storage |
| `POST /jobs/*` | Legacy aliases (backward compatible) |

---

## 13. Step-by-Step Migration Checklist

### Phase 1 — Setup

- [x] Create this migration plan
- [ ] Create Firebase project in Console
- [ ] Enable Auth (Email/Password), Firestore, Storage
- [ ] Download service account JSON (local only)
- [ ] Deploy security rules: `firebase deploy --only firestore:rules,storage`

### Phase 2 — Frontend infrastructure

- [x] Install `firebase` + `firebase-admin`
- [x] Add `src/lib/firebase/*` and `src/lib/services/*`
- [x] Add Firestore types and UI adapters
- [x] Update `src/lib/env.ts`
- [x] Add login/register pages
- [x] Update middleware for auth

### Phase 3 — Replace data layer

- [x] Migrate `src/lib/actions/projects.ts`
- [x] Migrate `src/lib/actions/classes.ts`
- [x] Migrate `src/lib/actions/datasets.ts`
- [x] Migrate `src/lib/actions/models.ts`
- [x] Migrate `src/lib/actions/uploads.ts`
- [x] Migrate `src/lib/actions/annotations.ts`
- [x] Migrate `src/lib/export/build.ts`
- [x] Update all RSC pages
- [x] Replace browser upload with Firebase Storage SDK

### Phase 4 — Python worker

- [x] Add `firebase-admin` to requirements
- [x] Implement `firebase_client.py` + `firestore_repo.py`
- [x] Migrate `storage.py`, `jobs.py`, `auto_label.py`, `test_run.py`, `model_compare.py`
- [ ] Add export service + `/api/export` (export still via Next.js API route)
- [x] Implement queue separation logic

### Phase 5 — Cleanup

- [x] Remove all Supabase imports and files (frontend)
- [x] Remove `@supabase/*` packages
- [ ] Update `setup.md` with Firebase instructions
- [x] Update `.env.local.example` and worker `.env.example`
- [ ] Verify acceptance criteria in production Firebase project

### Phase 6 — Data migration (optional, if existing Supabase data)

- [ ] Export Supabase data to JSON
- [ ] Script to import into Firestore + copy Storage objects
- [ ] Validate record counts and file URLs

---

## 14. Acceptance Criteria

- [ ] App runs without Supabase dependencies
- [ ] User can login/register via Firebase Auth
- [ ] User profiles and roles saved in Firestore
- [ ] User can create projects, classes, datasets
- [ ] Images upload to Firebase Storage; metadata in Firestore
- [ ] YOLO `.pt` models upload to Storage; metadata in Firestore
- [ ] Frontend calls Python worker successfully
- [ ] Worker reads files from Storage, runs YOLO inference
- [ ] Worker saves annotations to Firestore
- [ ] Model comparison works
- [ ] Full dataset auto-labelling works
- [ ] Images separated into review queues
- [ ] Review/edit/approve/reject annotations works
- [ ] Export YOLO/COCO/VOC/CSV to Storage with Firestore job records

---

## 15. Risk Notes

| Risk | Mitigation |
|------|------------|
| Firestore query limits | Index composite queries; paginate large datasets |
| Large model uploads | Firebase Storage supports large files; use resumable upload |
| Annotation split across collections | Adapter layer keeps UI unchanged |
| Auth added to previously open app | Login required; setup-error page for missing config |
| Worker on cloud needs credentials | `GOOGLE_APPLICATION_CREDENTIALS` or JSON env var |

---

*Last updated: migration implementation in progress.*
