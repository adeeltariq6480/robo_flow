"""Build export artifacts (ZIP) from approved annotations.

Supported formats: yolo (TXT), coco (JSON), voc (Pascal VOC XML), csv.
Boxes are stored normalized (xMin/yMin/xMax/yMax in 0..1).
Each export includes image files downloaded from Hugging Face Hub.
"""

import csv
import io
import json
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

from app.services import supabase_repo, supabase_storage


def _class_index_map(project_id: str) -> dict[str, int]:
    classes = supabase_repo.list_classes(project_id)
    return {c["className"]: c.get("classIndex", i) for i, c in enumerate(classes)}


def _stem(file_name: str) -> str:
    return file_name.rsplit(".", 1)[0] if "." in file_name else file_name


def _image_bytes(img: dict) -> bytes:
    repo = img.get("hfRepo")
    path = img.get("hfPath")
    if not repo or not path:
        raise ValueError(
            f"Image {img.get('fileName', img.get('id'))} has no Hugging Face location"
        )
    return supabase_storage.download_bytes(
        repo, path, repo_type=supabase_storage.REPO_TYPE_DATASET
    )


def _append_images(data: list[dict], files: dict[str, str | bytes]) -> None:
    for entry in data:
        img = entry["image"]
        files[f"images/{img['fileName']}"] = _image_bytes(img)


def build_export(project_id: str, export_format: str) -> tuple[bytes, str]:
    """Return (zip_bytes, file_name)."""
    fmt = export_format.lower()
    data = supabase_repo.get_approved_export_data(project_id)
    if not data:
        raise ValueError("No approved images to export. Review and approve labels first.")

    class_index = _class_index_map(project_id)
    classes_ordered = [
        name for name, _ in sorted(class_index.items(), key=lambda kv: kv[1])
    ]

    if fmt == "yolo":
        payload = _build_yolo(data, class_index, classes_ordered)
    elif fmt == "coco":
        payload = _build_coco(data, class_index, classes_ordered)
    elif fmt in ("voc", "pascal_voc", "pascalvoc"):
        payload = _build_voc(data, class_index)
    elif fmt == "csv":
        payload = _build_csv(data)
    else:
        raise ValueError(f"Unsupported export format: {export_format}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in payload.items():
            zf.writestr(path, content)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return buf.getvalue(), f"{fmt}-export-{ts}.zip"


def _build_yolo(data, class_index, classes_ordered) -> dict[str, str | bytes]:
    files: dict[str, str | bytes] = {}
    files["classes.txt"] = "\n".join(classes_ordered) + ("\n" if classes_ordered else "")
    names_block = "\n".join(
        f"  {i}: {json.dumps(name)}" for i, name in enumerate(classes_ordered)
    )
    files["data.yaml"] = (
        "# Axiom AI export — approved labels only\n"
        "path: .\n"
        "train: images\n"
        "val: images\n"
        f"names:\n{names_block}\n"
        f"nc: {len(classes_ordered)}\n"
    )
    files["README.txt"] = (
        "YOLO dataset export (approved labels only)\n\n"
        "Structure:\n"
        "  images/                      — image files\n"
        "  labels/<image_basename>.txt  — YOLO format (class cx cy w h, normalized)\n"
        "  classes.txt                  — class names, one per line\n"
        "  data.yaml                    — YOLO dataset config\n"
    )
    for entry in data:
        img = entry["image"]
        lines = []
        for o in entry["objects"]:
            idx = class_index.get(o.get("className"), 0)
            xc = (o["xMin"] + o["xMax"]) / 2
            yc = (o["yMin"] + o["yMax"]) / 2
            w = o["xMax"] - o["xMin"]
            h = o["yMax"] - o["yMin"]
            lines.append(f"{idx} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")
        files[f"labels/{_stem(img['fileName'])}.txt"] = "\n".join(lines) + (
            "\n" if lines else ""
        )
    _append_images(data, files)
    return files


def _build_coco(data, class_index, classes_ordered) -> dict[str, str | bytes]:
    categories = [
        {"id": class_index[name], "name": name, "supercategory": "none"}
        for name in classes_ordered
    ]
    images = []
    annotations = []
    ann_id = 1
    for img_id, entry in enumerate(data, start=1):
        img = entry["image"]
        w = img.get("width") or 0
        h = img.get("height") or 0
        images.append({
            "id": img_id,
            "file_name": img["fileName"],
            "width": w,
            "height": h,
        })
        for o in entry["objects"]:
            abs_xmin = o["xMin"] * w
            abs_ymin = o["yMin"] * h
            abs_w = (o["xMax"] - o["xMin"]) * w
            abs_h = (o["yMax"] - o["yMin"]) * h
            annotations.append({
                "id": ann_id,
                "image_id": img_id,
                "category_id": class_index.get(o.get("className"), 0),
                "bbox": [abs_xmin, abs_ymin, abs_w, abs_h],
                "area": abs_w * abs_h,
                "iscrowd": 0,
                "score": o.get("confidence", 1.0),
            })
            ann_id += 1
    coco = {"images": images, "annotations": annotations, "categories": categories}
    files: dict[str, str | bytes] = {"annotations.json": json.dumps(coco, indent=2)}
    _append_images(data, files)
    return files


def _build_voc(data, class_index) -> dict[str, str | bytes]:
    files: dict[str, str | bytes] = {}
    for entry in data:
        img = entry["image"]
        w = img.get("width") or 0
        h = img.get("height") or 0
        ann = ET.Element("annotation")
        ET.SubElement(ann, "filename").text = img["fileName"]
        size = ET.SubElement(ann, "size")
        ET.SubElement(size, "width").text = str(w)
        ET.SubElement(size, "height").text = str(h)
        ET.SubElement(size, "depth").text = "3"
        for o in entry["objects"]:
            obj = ET.SubElement(ann, "object")
            ET.SubElement(obj, "name").text = o.get("className", "unknown")
            ET.SubElement(obj, "difficult").text = "0"
            bnd = ET.SubElement(obj, "bndbox")
            ET.SubElement(bnd, "xmin").text = str(round(o["xMin"] * w))
            ET.SubElement(bnd, "ymin").text = str(round(o["yMin"] * h))
            ET.SubElement(bnd, "xmax").text = str(round(o["xMax"] * w))
            ET.SubElement(bnd, "ymax").text = str(round(o["yMax"] * h))
        xml = ET.tostring(ann, encoding="unicode")
        files[f"annotations/{_stem(img['fileName'])}.xml"] = xml
    _append_images(data, files)
    return files


def _build_csv(data) -> dict[str, str | bytes]:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "file_name", "class_name", "x_min", "y_min", "x_max", "y_max", "confidence",
    ])
    for entry in data:
        img = entry["image"]
        for o in entry["objects"]:
            writer.writerow([
                img["fileName"],
                o.get("className", "unknown"),
                round(o["xMin"], 6),
                round(o["yMin"], 6),
                round(o["xMax"], 6),
                round(o["yMax"], 6),
                round(o.get("confidence", 1.0), 4),
            ])
    files: dict[str, str | bytes] = {"annotations.csv": out.getvalue()}
    _append_images(data, files)
    return files
