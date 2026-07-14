"""One-click Google Colab launch — pre-filled notebook from app settings."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import uuid
from typing import Any

from app.config import settings

TOKEN_TTL_SECONDS = 900  # 15 minutes


def _signing_secret() -> bytes:
    raw = (
        os.getenv("COLAB_LAUNCH_SECRET", "").strip()
        or settings.supabase_service_role_key.strip()
        or os.getenv("WORKER_API_KEY", "").strip()
        or "robo-flow-colab-launch"
    )
    return raw.encode("utf-8")


def public_worker_url() -> str:
    explicit = os.getenv("PUBLIC_WORKER_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    railway = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway:
        return f"https://{railway}"
    return "https://roboflow-production.up.railway.app"


def github_repo_url() -> str:
    return os.getenv("COLAB_GITHUB_REPO", "").strip() or "https://github.com/adeeltariq6480/robo_flow.git"


def sign_launch_token(payload: dict[str, Any], ttl_seconds: int = TOKEN_TTL_SECONDS) -> str:
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl_seconds
    data = base64.urlsafe_b64encode(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8").rstrip("=")
    sig = hmac.new(_signing_secret(), data.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")
    return f"{data}.{sig_b64}"


def verify_launch_token(token: str) -> dict[str, Any]:
    try:
        data, sig_b64 = token.split(".", 1)
    except ValueError as exc:
        raise ValueError("Invalid launch token") from exc

    expected = hmac.new(
        _signing_secret(), data.encode("utf-8"), hashlib.sha256
    ).digest()
    pad = "=" * (-len(sig_b64) % 4)
    try:
        provided = base64.urlsafe_b64decode(sig_b64 + pad)
    except Exception as exc:
        raise ValueError("Invalid launch token signature") from exc

    if not hmac.compare_digest(expected, provided):
        raise ValueError("Invalid launch token signature")

    pad_data = "=" * (-len(data) % 4)
    payload = json.loads(base64.urlsafe_b64decode(data + pad_data).decode("utf-8"))
    if int(payload.get("exp") or 0) < int(time.time()):
        raise ValueError("Launch token expired — click Open in Colab again from the app")
    return payload


def github_colab_notebook_url() -> str:
    """Stable public notebook — cells always visible in Colab."""
    repo = github_repo_url().rstrip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    # https://github.com/user/repo -> colab github opener
    parts = repo.replace("https://github.com/", "").split("/")
    if len(parts) >= 2:
        owner, name = parts[0], parts[1]
        return (
            f"https://colab.research.google.com/github/{owner}/{name}/blob/main/"
            "notebooks/colab_auto_label.ipynb"
        )
    return (
        "https://colab.research.google.com/github/adeeltariq6480/robo_flow/blob/main/"
        "notebooks/colab_auto_label.ipynb"
    )


def build_prefill_url(token: str) -> str:
    encoded = urllib.parse.quote(token, safe="")
    return f"{public_worker_url()}/api/colab/prefill/{encoded}"


def build_colab_url(token: str) -> str:
    """Open the GitHub notebook (reliable). App also returns prefill_url for auto-config."""
    return github_colab_notebook_url()


def build_dynamic_notebook_url(token: str) -> str:
    """Fallback direct .ipynb URL (fixed format for Colab fileUrl import)."""
    encoded = urllib.parse.quote(token, safe="")
    notebook_url = f"{public_worker_url()}/api/colab/notebook/{encoded}.ipynb"
    return (
        "https://colab.research.google.com/#create=true&fileUrl="
        + urllib.parse.quote(notebook_url, safe="")
    )


def decode_notebook_token(token_path: str) -> str:
    raw = token_path.removesuffix(".ipynb") if token_path.endswith(".ipynb") else token_path
    return urllib.parse.unquote(raw)


def _notebook_cell(cell_type: str, source: list[str]) -> dict:
    cell: dict[str, Any] = {
        "cell_type": cell_type,
        "id": uuid.uuid4().hex[:12],
        "metadata": {},
        "source": source,
    }
    if cell_type == "code":
        cell["outputs"] = []
        cell["execution_count"] = None
    return cell


def build_prefill_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """JSON config Colab notebook fetches from the app (no secrets in GitHub notebook)."""
    project_id = str(payload["project_id"])
    dataset_id = str(payload["dataset_id"])
    model_ids = ",".join(str(m) for m in payload.get("model_ids") or [])
    return {
        "project_id": project_id,
        "dataset_id": dataset_id,
        "model_ids": model_ids,
        "job_id": str(payload.get("job_id") or ""),
        "confidence": float(payload.get("confidence") or 0.15),
        "iou": float(payload.get("iou") or 0.45),
        "relabel": bool(payload.get("relabel_all")),
        "repo_url": github_repo_url(),
        "railway_url": public_worker_url(),
        "supabase_url": settings.supabase_url,
        "supabase_service_role_key": settings.supabase_service_role_key,
        "hf_token": settings.hf_token,
        "hf_dataset_repo": settings.dataset_repo_id,
        "hf_model_repo": settings.model_repo_id,
        "worker_api_key": os.getenv("WORKER_API_KEY", "").strip(),
    }


def build_stock_prefill_payload(session: dict[str, Any], token: str) -> dict[str, Any]:
    return {
        "mode": "stock_url_check", "session_id": session["id"],
        "project_id": session["project_id"], "model_ids": ",".join(session["model_ids"]),
        "image_urls": session["urls"], "confidence": session["confidence"], "iou": session["iou"],
        "repo_url": github_repo_url(), "railway_url": public_worker_url(), "stock_token": token,
        "supabase_url": settings.supabase_url,
        "supabase_service_role_key": settings.supabase_service_role_key,
        "hf_token": settings.hf_token, "hf_dataset_repo": settings.dataset_repo_id,
        "hf_model_repo": settings.model_repo_id,
        "worker_api_key": os.getenv("WORKER_API_KEY", "").strip(),
    }


def build_prefilled_notebook(payload: dict[str, Any], token: str | None = None) -> dict:
    """Generate .ipynb with all secrets + IDs — user only Run All."""
    if payload.get("mode") == "stock_url_check":
        return build_stock_notebook(str(token or ""))
    project_id = str(payload["project_id"])
    dataset_id = str(payload["dataset_id"])
    model_ids = ",".join(str(m) for m in payload.get("model_ids") or [])
    job_id = str(payload.get("job_id") or "")
    confidence = float(payload.get("confidence") or 0.15)
    iou = float(payload.get("iou") or 0.45)
    relabel = bool(payload.get("relabel_all"))
    repo_url = github_repo_url()
    railway_url = public_worker_url()
    worker_key = os.getenv("WORKER_API_KEY", "").strip()

    setup_source = [
        "import os, subprocess, sys\n",
        "\n",
        f'os.environ["SUPABASE_URL"] = {json.dumps(settings.supabase_url)}\n',
        f'os.environ["SUPABASE_SERVICE_ROLE_KEY"] = {json.dumps(settings.supabase_service_role_key)}\n',
        f'os.environ["HF_TOKEN"] = {json.dumps(settings.hf_token)}\n',
        f'os.environ["HF_DATASET_REPO"] = {json.dumps(settings.dataset_repo_id)}\n',
        f'os.environ["HF_MODEL_REPO"] = {json.dumps(settings.model_repo_id)}\n',
        'os.environ["HF_DATASET_REPO_TYPE"] = "dataset"\n',
        'os.environ["HF_MODEL_REPO_TYPE"] = "model"\n',
        f'os.environ["RAILWAY_WORKER_URL"] = {json.dumps(railway_url)}\n',
        f'os.environ["WORKER_API_KEY"] = {json.dumps(worker_key)}\n',
        "\n",
        f'PROJECT_ID = {json.dumps(project_id)}\n',
        f'DATASET_ID = {json.dumps(dataset_id)}\n',
        f'MODEL_IDS = {json.dumps(model_ids)}\n',
        f"JOB_ID = {json.dumps(job_id)}\n",
        f"CONFIDENCE = {confidence}\n",
        f"IOU = {iou}\n",
        f"REPO_URL = {json.dumps(repo_url)}\n",
        f"RAILWAY_URL = {json.dumps(railway_url)}\n",
        'print("Config loaded for project:", PROJECT_ID)\n',
        'print("Dataset:", DATASET_ID, "| Models:", MODEL_IDS)\n',
        'if JOB_ID:\n',
        '    print("Job id (track in app):", JOB_ID)\n',
    ]

    install_source = [
        "print('=' * 60)\n",
        "print('STEP 1/2: Installing packages (2–5 minutes). Please wait…')\n",
        "print('=' * 60)\n",
        f"!git clone {json.dumps(repo_url)} robo_flow 2>/dev/null || (cd robo_flow && git pull)\n",
        "%cd robo_flow/worker\n",
        "!pip install -q -r requirements.txt\n",
        "print('Install done. GPU:', end=' ')\n",
        "!nvidia-smi -L 2>/dev/null || print('CPU only — set Runtime → Change runtime type → T4 GPU')\n",
    ]

    run_source = [
        "print('=' * 60)\n",
        "print('STEP 2/2: Starting auto-label. Watch your Vercel app for progress.')\n",
        "print('=' * 60)\n",
        "cmd = [\n",
        "    sys.executable,\n",
        "    'scripts/colab_auto_label.py',\n",
        "    '--project-id', PROJECT_ID,\n",
        "    '--dataset-id', DATASET_ID,\n",
        "    '--model-ids', MODEL_IDS,\n",
        "    '--confidence', str(CONFIDENCE),\n",
        "    '--iou', str(IOU),\n",
        "    '--railway-url', RAILWAY_URL,\n",
        "]\n",
        "if JOB_ID:\n",
        "    cmd.extend(['--job-id', JOB_ID])\n",
        f"if {json.dumps(relabel)}:\n",
        "    cmd.append('--relabel')\n",
        "if os.environ.get('WORKER_API_KEY'):\n",
        "    cmd.extend(['--worker-api-key', os.environ['WORKER_API_KEY']])\n",
        "print('Running:', ' '.join(cmd))\n",
        "result = subprocess.run(cmd, check=False)\n",
        "if result.returncode != 0:\n",
        "    raise SystemExit(result.returncode)\n",
    ]

    cells = [
        _notebook_cell(
            "markdown",
            [
                "# Robo Flow — auto-label (pre-filled from your app)\n",
                "\n",
                "**Run → Run all** (or Runtime → Run all). Nothing to paste.\n",
                "\n",
                "- Tries Colab GPU first\n",
                "- Auto-fallback to Railway if Colab fails\n",
                "- Watch progress in your Vercel app\n",
            ],
        ),
        _notebook_cell("code", setup_source),
        _notebook_cell("code", install_source),
        _notebook_cell("code", run_source),
    ]

    return {
        "nbformat": 4,
        "nbformat_minor": 4,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.10.0"},
        },
        "cells": cells,
    }


def build_stock_notebook(token: str) -> dict:
    config_url = f"{public_worker_url()}/api/stock-colab/config/{urllib.parse.quote(token, safe='')}"
    cells = [
        _notebook_cell("markdown", ["# Robo Flow — temporary Stock Check\n", "Run **Runtime → Run all**. Nothing is saved to the database.\n"]),
        _notebook_cell("code", [
            "import json, os, subprocess, sys, urllib.request\n", f"CONFIG_URL = {json.dumps(config_url)}\n",
            "with urllib.request.urlopen(CONFIG_URL, timeout=60) as r:\n", "    cfg = json.loads(r.read().decode('utf-8'))\n",
            "for key, cfg_key in [('SUPABASE_URL','supabase_url'),('SUPABASE_SERVICE_ROLE_KEY','supabase_service_role_key'),('HF_TOKEN','hf_token'),('HF_DATASET_REPO','hf_dataset_repo'),('HF_MODEL_REPO','hf_model_repo'),('WORKER_API_KEY','worker_api_key')]:\n",
            "    os.environ[key] = cfg.get(cfg_key) or ''\n", "print('Loaded', len(cfg['image_urls']), 'temporary URLs')\n",
        ]),
        _notebook_cell("code", [
            f"!git clone {json.dumps(github_repo_url())} robo_flow 2>/dev/null || (cd robo_flow && git pull)\n",
            "%cd robo_flow/worker\n", "!pip install -q -r requirements.txt\n", "!nvidia-smi -L\n",
        ]),
        _notebook_cell("code", [
            "result = subprocess.run([sys.executable, 'scripts/colab_stock_url_check.py', '--config-url', CONFIG_URL], check=False)\n",
            "if result.returncode: raise SystemExit(result.returncode)\n",
        ]),
    ]
    return {"nbformat": 4, "nbformat_minor": 4, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}}, "cells": cells}
