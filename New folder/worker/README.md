# Robo Flow — Python YOLO Worker

FastAPI worker for YOLO inference with **three separate job queues**:

| Queue | Job type | Priority | Use case |
|-------|----------|----------|----------|
| `interactive` | `test_run` | Highest | Single-image quick test |
| `compare` | `model_compare` | Medium | Compare 2–5 models on same image |
| `batch` | `auto_label` | Lowest | Full dataset auto-labelling |

## Setup

### 1. Database migration

Run in Supabase SQL Editor **after** `ml_schema.sql`:

```
supabase/migrations/20240625000000_worker_jobs.sql
```

### 2. Python environment

```bash
cd worker
python -m venv .venv

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
```

### 3. Environment

```bash
cp .env.example .env
```

Set:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_API_KEY=dev-worker-key
```

Or reuse root `.env.local` — add `SUPABASE_URL` (same value as `NEXT_PUBLIC_SUPABASE_URL`).

### 4. Run worker

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API docs: http://localhost:8000/docs

## API endpoints

All requests require header: `X-Worker-Key: <WORKER_API_KEY>`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/jobs/test-run` | Queue single-image inference |
| `POST` | `/jobs/auto-label` | Queue full dataset labelling |
| `POST` | `/jobs/model-compare` | Queue multi-model comparison |
| `GET` | `/jobs/{id}` | Job status + progress |
| `GET` | `/jobs/{id}/items` | Per-file items (auto-label) |
| `GET` | `/jobs/queues/stats` | Queue depths |
| `GET` | `/health` | Health check |

## Example: test run

```bash
curl -X POST http://localhost:8000/jobs/test-run \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: dev-worker-key" \
  -d '{
    "project_id": "YOUR_PROJECT_ID",
    "model_id": "YOUR_MODEL_ID",
    "dataset_file_id": "YOUR_FILE_ID",
    "config": { "confidence": 0.3 }
  }'
```

Poll progress:

```bash
curl http://localhost:8000/jobs/JOB_ID -H "X-Worker-Key: dev-worker-key"
```

## Queue separation logic

- Each queue has its own worker limit (`INTERACTIVE_QUEUE_WORKERS`, etc.)
- Dispatcher always prefers `interactive` → `compare` → `batch`
- Batch jobs never block test-runs
- Progress is written to `inference_jobs` in Supabase (Realtime enabled)

## Auto-label output

For each image in the dataset:

1. YOLO runs inference
2. Detections saved to `dataset_files.annotations` (JSON)
3. Primary class set on `dataset_files.class_id`
4. Per-file progress in `inference_job_items`

## Model compare winner

Winner = most detections, tie-breaker = higher average confidence.
