"""Auto-fix orientation and reject blurry images on dataset upload."""

from __future__ import annotations

import io
import gc
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from app.config import settings

logger = logging.getLogger(__name__)

MIME_FOR_FORMAT = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}


@dataclass
class PreprocessResult:
    accepted: bool
    data: bytes
    width: int
    height: int
    mime_type: str
    rotated_to_portrait: bool = False
    exif_corrected: bool = False
    skip_reason: str | None = None


def _laplacian_variance(gray: Image.Image) -> float:
    """Higher = sharper. Typical sharp photos are well above ~100–150."""
    arr = np.asarray(gray, dtype=np.float32)
    h, w = arr.shape
    if h < 3 or w < 3:
        return 0.0
    center = arr[1:-1, 1:-1]
    lap = (
        -4 * center
        + arr[:-2, 1:-1]
        + arr[2:, 1:-1]
        + arr[1:-1, :-2]
        + arr[1:-1, 2:]
    )
    return float(lap.var())


@dataclass
class BlurMetrics:
    laplacian: float
    sobel_mean: float

    @property
    def is_sharp(self) -> bool:
        return (
            self.laplacian >= settings.upload_blur_threshold
            and self.sobel_mean >= settings.upload_blur_sobel_threshold
        )

    def is_sharp_for_auto_label(self) -> bool:
        return (
            self.laplacian >= settings.auto_label_blur_threshold
            and self.sobel_mean >= settings.auto_label_blur_sobel_threshold
        )


def _gray_for_blur(img: Image.Image) -> Image.Image:
    blur_img = img
    blur_max = max(1, int(settings.upload_blur_max_side))
    if img.width > blur_max or img.height > blur_max:
        blur_img = img.copy()
        blur_img.thumbnail((blur_max, blur_max), Image.Resampling.LANCZOS)
    return blur_img.convert("L")


def _sobel_mean(gray_arr: np.ndarray) -> float:
    gx = np.zeros_like(gray_arr)
    gy = np.zeros_like(gray_arr)
    gx[:, 1:-1] = gray_arr[:, 2:] - gray_arr[:, :-2]
    gy[1:-1, :] = gray_arr[2:, :] - gray_arr[:-2, :]
    return float(np.sqrt(gx * gx + gy * gy).mean())


def blur_metrics_for_image(img: Image.Image) -> BlurMetrics:
    gray = np.asarray(_gray_for_blur(img), dtype=np.float32)
    return BlurMetrics(laplacian=_laplacian_variance(gray), sobel_mean=_sobel_mean(gray))


def blur_score_for_image(img: Image.Image) -> float:
    """Backward-compatible single score (min of normalized laplacian/sobel)."""
    metrics = blur_metrics_for_image(img)
    return min(metrics.laplacian, metrics.sobel_mean * 10.0)


def blur_metrics_for_path(path: str | Path) -> BlurMetrics:
    with Image.open(path) as opened:
        img = ImageOps.exif_transpose(opened)
        if img.mode != "RGB":
            img = img.convert("RGB")
        return blur_metrics_for_image(img)


def is_image_too_blurry(
    path: str | Path,
    *,
    for_auto_label: bool = False,
    threshold: float | None = None,
) -> tuple[bool, BlurMetrics]:
    """Return (too_blurry, metrics). Rejects when laplacian OR sobel is too low."""
    metrics = blur_metrics_for_path(path)
    if for_auto_label or settings.auto_label_reject_blurry:
        too_blurry = not metrics.is_sharp_for_auto_label()
    else:
        too_blurry = not metrics.is_sharp()
    if threshold is not None:
        too_blurry = metrics.laplacian < threshold
    return too_blurry, metrics


def _encode_image(img: Image.Image, original_format: str | None) -> tuple[bytes, str]:
    buf = io.BytesIO()
    if img.mode != "RGB":
        img = img.convert("RGB")
    quality = max(60, min(100, int(settings.upload_jpeg_quality)))
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue(), MIME_FOR_FORMAT["JPEG"]


def preprocess_upload_image(data: bytes, file_name: str) -> PreprocessResult:
    """
    1. Fix EXIF orientation.
    2. Rotate landscape → portrait when enabled.
    3. Reject blurry images when enabled.
    """
    try:
        with Image.open(io.BytesIO(data)) as opened:
            original_format = opened.format
            before_size = opened.size
            img = ImageOps.exif_transpose(opened)
            exif_corrected = img.size != before_size

            if img.mode != "RGB":
                img = img.convert("RGB")

            rotated = False
            if settings.upload_auto_portrait and img.width > img.height:
                img = img.transpose(Image.ROTATE_90)
                rotated = True

            if settings.upload_reject_blurry:
                metrics = blur_metrics_for_image(img)
                if not metrics.is_sharp():
                    logger.info(
                        "Skipping blurry upload %s (laplacian=%.2f < %.2f or sobel=%.2f < %.2f)",
                        file_name,
                        metrics.laplacian,
                        settings.upload_blur_threshold,
                        metrics.sobel_mean,
                        settings.upload_blur_sobel_threshold,
                    )
                    return PreprocessResult(
                        accepted=False,
                        data=b"",
                        width=0,
                        height=0,
                        mime_type="",
                        skip_reason="blurry",
                    )

            max_side = max(1, int(settings.upload_max_image_size))
            if img.width > max_side or img.height > max_side:
                img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

            width = img.width
            height = img.height
            out_bytes, mime = _encode_image(img, original_format)
            del img
            gc.collect()

            return PreprocessResult(
                accepted=True,
                data=out_bytes,
                width=width,
                height=height,
                mime_type=mime,
                rotated_to_portrait=rotated,
                exif_corrected=exif_corrected,
            )
    except Exception as exc:
        logger.warning("Could not preprocess %s: %s", file_name, exc)
        return PreprocessResult(
            accepted=False,
            data=b"",
            width=0,
            height=0,
            mime_type="",
            skip_reason="invalid_image",
        )


def _guess_mime(fmt: str | None, file_name: str) -> str:
    if fmt:
        return MIME_FOR_FORMAT.get(fmt.upper(), "image/jpeg")
    lower = file_name.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"
