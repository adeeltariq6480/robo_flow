"""Auto-fix orientation and reject blurry images on dataset upload."""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

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
    """Higher = sharper. Typical sharp photos are well above ~80–120."""
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


def _encode_image(img: Image.Image, original_format: str | None) -> tuple[bytes, str]:
    buf = io.BytesIO()
    fmt = (original_format or "JPEG").upper()
    if fmt == "JPG":
        fmt = "JPEG"
    if fmt not in MIME_FOR_FORMAT:
        fmt = "JPEG"
    save_kwargs: dict = {}
    if fmt == "JPEG":
        save_kwargs["quality"] = 92
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
    elif img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
    img.save(buf, format=fmt, **save_kwargs)
    return buf.getvalue(), MIME_FOR_FORMAT[fmt]


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

            rotated = False
            if settings.upload_auto_portrait and img.width > img.height:
                img = img.transpose(Image.ROTATE_90)
                rotated = True

            if settings.upload_reject_blurry:
                score = _laplacian_variance(img.convert("L"))
                if score < settings.upload_blur_threshold:
                    logger.info(
                        "Skipping blurry upload %s (laplacian=%.2f < %.2f)",
                        file_name,
                        score,
                        settings.upload_blur_threshold,
                    )
                    return PreprocessResult(
                        accepted=False,
                        data=b"",
                        width=0,
                        height=0,
                        mime_type="",
                        skip_reason="blurry",
                    )

            if exif_corrected or rotated:
                out_bytes, mime = _encode_image(img, original_format)
            else:
                out_bytes, mime = data, _guess_mime(original_format, file_name)

            return PreprocessResult(
                accepted=True,
                data=out_bytes,
                width=img.width,
                height=img.height,
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
