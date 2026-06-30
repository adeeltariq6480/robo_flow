# Robo Flow — Firebase + Hugging Face (No-Auth) Setup

This guide explains the new architecture and how to run it locally.

## Architecture

```
┌────────────────────┐        HTTP (REST + multipart)        ┌──────────────────────────┐
│  Next.js frontend  │  ───────────────────────────────────► │  Python FastAPI backend   │
│  (no auth, no      │   NEXT_PUBLIC_WORKER_API_URL           │  (the only place with     │
│   secrets)         │                                        │   secrets)                │
└────────────────────┘                                        └─────────────┬─────────────┘
                                                                            │
                                          Firestore (metadata)  ◄───────────┤
                                          Hugging Face Hub (files) ◄─────────┘
```

- **Frontend** holds **no secrets**. It talks only to the FastAPI backend.
- **Firebase Firestore** stores **metadata only** (projects, classes, datasets, image/model
  metadata, annotations, jobs, review queues, exports). There is **no Firebase Storage**.
- **Hugging Face Hub** stores all **binary files**: dataset images, ZIP datasets,
  YOLO `.pt` models, generated labels, and exports.
- **No authentication**: no signup, login, Firebase Auth, roles, or protected routes.
  The app opens directly on the project list.

## 1. Create a Firebase Firestore database

1. Go to the [Firebase console](https://console.firebase.google.com/) and create (or open) a project.
2. In the left sidebar: **Build → Firestore Database → Create database**.
3. Choose **Start in production mode** (or test mode for local dev) and pick a region.
4. Create a **service account** for the backend:
   - **Project settings → Service accounts → Generate new private key**.
   - Save the downloaded JSON as `worker/service-account.json`
     (it is git-ignored; never commit it).
5. Note your **Project ID** (Project settings → General).

> The backend uses the Firebase Admin SDK with this service account. Firestore is the
> only Firebase product used — **Storage is not enabled and not required**.

## 2. Create a Hugging Face account, token, and repos

1. Sign up at [huggingface.co](https://huggingface.co/join).
2. Create a **write token**: [Settings → Access Tokens](https://huggingface.co/settings/tokens)
   → **New token** → role **Write**. Copy it (`hf_...`).
3. You can let the backend auto-create the repos on first upload, or create them manually:
   - **Dataset repo** (for images/zips/labels/exports):
     [New dataset](https://huggingface.co/new-dataset) → e.g. `your-username/robo-flow-datasets` → **Private**.
   - **Model repo** (for `.pt` weights):
     [New model](https://huggingface.co/new) → e.g. `your-username/robo-flow-models` → **Private**.

### Hugging Face folder layout

```
Dataset repo:
  datasets/{projectId}/{datasetId}/images/
  datasets/{projectId}/{datasetId}/zips/
  labels/{projectId}/
  exports/{projectId}/

Model repo:
  models/{projectId}/
```

## 3. Configure environment variables

### Backend (`worker/.env`)

Copy `worker/.env.example` to `worker/.env`:

```bash
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=service-account.json
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
HF_USERNAME=your-hf-username
HF_DATASET_REPO=your-hf-username/robo-flow-datasets
HF_MODEL_REPO=your-hf-username/robo-flow-models
WORKER_PORT=8000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
WORKER_API_KEY=
```

> Leave `WORKER_API_KEY` empty for local no-auth mode. If you set it, the frontend must
> send it as the `X-Worker-Key` header (not needed for local development).

### Frontend (`.env.local`)

Copy `.env.local.example` to `.env.local`:

```bash
NEXT_PUBLIC_WORKER_API_URL=http://localhost:8000
```

That is the **only** variable the frontend needs. No Firebase keys, no HF token.

## 4. Run the backend (FastAPI)

```bash
cd worker
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check: open <http://localhost:8000/health> → `{"status":"ok", ...}`.
Interactive API docs: <http://localhost:8000/docs>.

## 5. Run the frontend (Next.js)

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The app opens straight to the **project list** — no login.

## 6. End-to-end flow

1. **Create a project** → saved in Firestore `projects`.
2. **Add classes** → saved in `projects/{id}/classes`.
3. **Create a dataset** and **upload images** → files go to Hugging Face,
   metadata to `projects/{id}/images`.
4. **Upload a YOLO `.pt` model** → file to Hugging Face model repo, metadata to
   `projects/{id}/models`.
5. **Auto-label** a dataset → backend downloads the model + images from Hugging Face,
   runs YOLO, writes annotations + review queues to Firestore.
6. **Review / edit / approve / reject** annotations in the editor.
7. **Export** approved labels (YOLO TXT / COCO JSON / Pascal VOC XML / CSV) → built by the
   backend and uploaded to Hugging Face under `exports/{projectId}/`.

## API summary (FastAPI)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| GET | `/api/projects/{projectId}` | Get project |
| GET | `/api/projects/{projectId}/stats` | Project counts |
| PUT | `/api/projects/{projectId}` | Update project |
| DELETE | `/api/projects/{projectId}` | Delete project + metadata |
| POST | `/api/classes` | Save/import classes |
| GET | `/api/classes/{projectId}` | List classes |
| POST | `/api/datasets` | Create dataset |
| GET | `/api/datasets/{projectId}` | List datasets |
| GET | `/api/datasets/{projectId}/{datasetId}/images` | List images |
| GET | `/api/datasets/{projectId}/{datasetId}/review` | Images + annotations for review |
| DELETE | `/api/datasets/{projectId}/{datasetId}` | Delete dataset |
| POST | `/api/upload-images` | Upload images → Hugging Face |
| POST | `/api/upload-zip` | Upload + extract ZIP → Hugging Face |
| POST | `/api/upload-model` | Upload `.pt` model → Hugging Face |
| GET | `/api/models/{projectId}` | List models |
| GET | `/api/images/{projectId}/{imageId}/content` | Stream image bytes (HF proxy) |
| POST | `/api/test-run` | Run model(s) on a test image (job) |
| POST | `/api/auto-label` | Auto-label a dataset (job) |
| GET | `/api/jobs/{projectId}/{jobId}` | Job status/progress |
| GET | `/api/review-queues/{projectId}` | Queue counts + images |
| GET | `/api/annotations/{projectId}/{imageId}` | Get annotations |
| PUT | `/api/annotations/{projectId}/{imageId}` | Save edited annotations |
| POST | `/api/approve-image` | Approve image annotations |
| POST | `/api/reject-image` | Reject image annotations |
| POST | `/api/export` | Export approved labels → Hugging Face |

## 7. Deploy frontend on Vercel

1. Deploy the **FastAPI worker first** (see section 4) on a public host and note its URL,
   e.g. `https://your-api.railway.app`.
2. In **Vercel → Project → Settings → Environment Variables**, set:
   ```bash
   NEXT_PUBLIC_WORKER_API_URL=https://your-api.railway.app
   ```
   **Do not use `http://localhost:8000` in production** — Vercel serverless functions
   cannot reach your laptop; that causes a 500 error on page load.
3. Remove obsolete variables if present (`FIREBASE_SERVICE_ACCOUNT_JSON`,
   `NEXT_PUBLIC_FIREBASE_*`, etc.) — the frontend no longer uses Firebase directly.
4. Redeploy after changing env vars.

If the backend URL is wrong, the home page shows a **Backend not reachable** setup
card instead of crashing.

After auto-labelling, each image is placed into one of:
`good`, `no_label`, `low_label`, `low_confidence`, `conflict`, `class_missing`.
