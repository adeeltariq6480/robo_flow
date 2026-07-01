import asyncio

from app.core.jobs import update_job
from app.models.schemas import InferenceResult, JobConfig, ModelCompareResult
from app.services.storage import (
    build_class_name_map,
    download_model,
    get_project_class_map,
)
from app.services.test_run import _resolve_image
from app.services.yolo_inference import run_yolo_inference


async def run_model_compare(
    job_id: str,
    project_id: str,
    data: dict,
    config: JobConfig,
) -> dict:
    model_ids = [str(m) for m in (data.get("model_ids") or [])]
    if len(model_ids) < 2:
        raise ValueError("model_compare requires at least 2 model_ids")

    class_id_map = get_project_class_map(project_id)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)

    image_path, file_id = await _resolve_image(project_id, data)

    results: dict[str, InferenceResult] = {}
    step = int(80 / len(model_ids))

    for i, model_id in enumerate(model_ids):
        pct = 10 + i * step
        await update_job(
            job_id,
            progress=pct,
            progress_message=f"Running model {i + 1}/{len(model_ids)}…",
            project_id=project_id,
        )

        model_path = await asyncio.to_thread(download_model, model_id, project_id)

        inference = await asyncio.to_thread(
            run_yolo_inference,
            model_path,
            image_path,
            config,
            model_name=model_id,
            class_id_map=class_id_map,
        )
        results[model_id] = inference

    compare = _pick_winner(results)
    compare_result = ModelCompareResult(
        models={k: v for k, v in results.items()},
        winner_model_id=compare["winner_id"],
        winner_reason=compare["reason"],
    )

    return {
        "job_type": "model_compare",
        "dataset_file_id": file_id,
        "comparison": compare_result.model_dump(),
    }


def _pick_winner(results: dict[str, InferenceResult]) -> dict:
    if not results:
        return {"winner_id": None, "reason": "No results"}

    scored: list[tuple[str, int, float]] = []
    for model_id, inf in results.items():
        count = len(inf.detections)
        avg_conf = (
            sum(d.confidence for d in inf.detections) / count if count else 0.0
        )
        scored.append((model_id, count, avg_conf))

    scored.sort(key=lambda x: (x[1], x[2]), reverse=True)
    winner_id, count, avg_conf = scored[0]

    reason = f"{count} detections, avg confidence {avg_conf:.2f}"
    if len(scored) > 1 and scored[0][1] == scored[1][1]:
        reason += " (tied on count, won on confidence)"

    return {"winner_id": winner_id, "reason": reason}
