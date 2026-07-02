# Supabase setup (Axiom AI)

Firebase + Hugging Face have been replaced with **Supabase Postgres + Storage**.  
The frontend still talks to the **FastAPI worker** — only Railway env changes.

---

## 1. Create Supabase project

1. Go to [supabase.com](https://supabase.com) → New project  
2. Note your **Project URL** and **service_role** key (Settings → API)

---

## 2. Run the schema

Supabase Dashboard → **SQL Editor** → New query → paste and run:

**File:** [`supabase/schema_reset.sql`](../supabase/schema_reset.sql)

This **drops** old tables (`dataset_files`, `inference_jobs`, …) and creates the **current** schema (`images`, `labelling_jobs`, …).

> Do **not** use `ml_schema.sql` — that is the legacy schema and will cause `PGRST205` / missing `images` table errors.

---

## 3. Railway (worker)

Set these variables (remove old `FIREBASE_*` and `HF_*`):

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role secret |
| `CORS_ORIGINS` | your Vercel URL + `http://localhost:3000` |
| `WORKER_API_KEY` | optional (empty = open) |

Redeploy the worker after saving.

Health check should return:

```json
{"status":"ok","config":{"supabase":true}}
```

---

## 4. Vercel (frontend)

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_WORKER_API_URL` | Railway public URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon / publishable key (for large model uploads direct to Storage) |
| `WORKER_API_KEY` | same as Railway (or empty) |

Redeploy frontend.

---

## 5. Local dev

**worker/.env**

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
CORS_ORIGINS=http://localhost:3000
```

**`.env.local` (project root)**

```env
NEXT_PUBLIC_WORKER_API_URL=http://localhost:8000
```

```bash
cd worker && uvicorn main:app --reload --port 8000
npm run dev
```

---

## Tables overview

| Table | Purpose |
|-------|---------|
| `projects` | Projects |
| `classes` | Class labels per project |
| `datasets` | Datasets |
| `images` | Dataset images (metadata) |
| `models` | YOLO models |
| `annotations` | Per-image annotation record |
| `annotation_objects` | Bounding boxes |
| `labelling_jobs` | Auto-label / test-run jobs |
| `job_registry` | Job → project lookup |
| `export_jobs` | Export history |

Files live in **Supabase Storage** buckets; DB stores `hf_repo` (bucket) + `hf_path` (object path) for API compatibility.

---

## Migrating old Firebase data

There is no automatic migration. For a fresh start, run the schema and re-upload projects/models/images.  
To migrate existing data you would need a one-off export/import script (not included).
