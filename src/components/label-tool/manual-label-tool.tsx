"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Plus,
  Search,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Model } from "@/lib/types/database";
import { ModelMultiSelect } from "@/components/inference/model-multi-select";
import {
  deleteTemporaryLabelSession,
  getTemporaryLabelSession,
  startTemporaryLabelSession,
  startTemporaryTraining,
  type TemporaryLabelSession,
} from "@/lib/api/temporary-label-tool";

type Box = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  className: string;
  confidence?: number;
  source?: "manual" | "yolo" | "reference_matcher";
};
type LabelImage = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  boxes: Box[];
};
type ReferenceImage = { id: string; file: File; url: string };
type ReferenceProduct = {
  id: string;
  className: string;
  images: ReferenceImage[];
};
type Draft = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
type PendingBox = Omit<Box, "className"> & { imageId: string };
type StoredImage = Omit<LabelImage, "url">;
type StoredReference = {
  id: string;
  className: string;
  images: Omit<ReferenceImage, "url">[];
};
type ToolMode = "manual" | "auto";
type StoredSession = {
  images: StoredImage[];
  classes: string[];
  activeId: string | null;
  references?: StoredReference[];
  productsSubmitted?: boolean;
  colabToken?: string | null;
  configUrl?: string | null;
  toolMode?: ToolMode | null;
  trainingToken?: string | null;
  trainingConfigUrl?: string | null;
};

const COLORS = [
  "#10b981",
  "#06b6d4",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
];
const safeName = (value: string) =>
  value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "object";
const baseName = (name: string) => name.replace(/\.[^.]+$/, "");
const escapeXml = (value: string) =>
  value.replace(
    /[<>&'\"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c]!,
  );
const DB_NAME = "axiom-manual-label-tool";
const STORE_NAME = "sessions";

function openSessionDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSession(key: string) {
  const db = await openSessionDb();
  return new Promise<StoredSession | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => {
      resolve(request.result as StoredSession | undefined);
      db.close();
    };
    request.onerror = () => {
      reject(request.error);
      db.close();
    };
  });
}

async function writeSession(key: string, session: StoredSession) {
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put(session, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function deleteSession(key: string) {
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export function ManualLabelTool({
  projectId,
  models,
}: {
  projectId: string;
  models: Model[];
}) {
  const [images, setImages] = useState<LabelImage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [newClass, setNewClass] = useState("");
  const [bulkClasses, setBulkClasses] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [pendingBox, setPendingBox] = useState<PendingBox | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [confirmClose, setConfirmClose] = useState(false);
  const [references, setReferences] = useState<ReferenceProduct[]>([]);
  const [referenceClass, setReferenceClass] = useState("");
  const [referenceUploadTarget, setReferenceUploadTarget] = useState<
    string | null
  >(null);
  const [matchThreshold, setMatchThreshold] = useState(0.8);
  const [autoMatching, setAutoMatching] = useState(false);
  const [autoProgress, setAutoProgress] = useState("");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [productsSubmitted, setProductsSubmitted] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(
    models[0] ? [models[0].id] : [],
  );
  const [confidence, setConfidence] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [colabToken, setColabToken] = useState<string | null>(null);
  const [configUrl, setConfigUrl] = useState<string | null>(null);
  const [remoteSession, setRemoteSession] =
    useState<TemporaryLabelSession | null>(null);
  const [training, setTraining] = useState(false);
  const [trainingToken, setTrainingToken] = useState<string | null>(null);
  const [trainingConfigUrl, setTrainingConfigUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const classFileRef = useRef<HTMLInputElement>(null);
  const referenceFileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imagesRef = useRef<LabelImage[]>([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () =>
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void readSession(projectId)
      .then((session) => {
        if (cancelled || !session) return;
        const restored = session.images.map((image) => ({
          ...image,
          url: URL.createObjectURL(image.file),
        }));
        const restoredReferences = (session.references ?? []).map(
          (reference) => ({
            ...reference,
            images: reference.images.map((image) => ({
              ...image,
              url: URL.createObjectURL(image.file),
            })),
          }),
        );
        setImages(restored);
        setClasses(session.classes);
        setReferences(restoredReferences);
        setActiveId(session.activeId ?? restored[0]?.id ?? null);
        setProductsSubmitted(Boolean(session.productsSubmitted));
        setColabToken(session.colabToken ?? null);
      setConfigUrl(session.configUrl ?? null);
      setToolMode(session.toolMode ?? null);
      setTrainingToken(session.trainingToken ?? null);
      setTrainingConfigUrl(session.trainingConfigUrl ?? null);
      })
      .catch(() => {
        /* IndexedDB may be disabled in private mode */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!hydrated) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const storedImages = images.map(({ url: _url, ...image }) => image);
      const storedReferences = references.map((reference) => ({
        ...reference,
        images: reference.images.map(({ url: _url, ...image }) => image),
      }));
      void writeSession(projectId, {
        images: storedImages,
        classes,
        activeId,
        references: storedReferences,
        productsSubmitted,
        colabToken,
        configUrl,
        toolMode,
        trainingToken,
        trainingConfigUrl,
      })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("saved"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    images,
    classes,
    activeId,
    references,
    productsSubmitted,
    colabToken,
    configUrl,
    toolMode,
    trainingToken,
    trainingConfigUrl,
    hydrated,
    projectId,
  ]);

  const active = images.find((image) => image.id === activeId) ?? null;
  const activeIndex = active
    ? images.findIndex((image) => image.id === active.id)
    : -1;
  const selectedBox =
    active?.boxes.find((box) => box.id === selectedBoxId) ?? null;
  const boxCount = useMemo(
    () => images.reduce((sum, image) => sum + image.boxes.length, 0),
    [images],
  );
  const filteredClasses = useMemo(() => {
    const query = classSearch.trim().toLocaleLowerCase();
    return query
      ? classes.filter((name) => name.toLocaleLowerCase().includes(query))
      : classes;
  }, [classes, classSearch]);

  async function addFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    const loaded = await Promise.all(
      accepted.map(async (file) => {
        const url = URL.createObjectURL(file);
        const size = await new Promise<{ width: number; height: number }>(
          (resolve, reject) => {
            const img = new Image();
            img.onload = () =>
              resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = reject;
            img.src = url;
          },
        );
        return {
          id: crypto.randomUUID(),
          file,
          url,
          ...size,
          boxes: [],
        } satisfies LabelImage;
      }),
    );
    setImages((current) => [...current, ...loaded]);
    if (!activeId && loaded[0]) setActiveId(loaded[0].id);
  }

  function pointerPosition(event: React.PointerEvent) {
    const image = imageRef.current;
    if (!image) return null;
    const rect = image.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return { x: x / rect.width, y: y / rect.height };
  }

  function startBox(event: React.PointerEvent) {
    if (!active) return;
    const point = pointerPosition(event);
    if (!point) return;
    const hit = [...active.boxes]
      .reverse()
      .find(
        (box) =>
          point.x >= box.x &&
          point.x <= box.x + box.width &&
          point.y >= box.y &&
          point.y <= box.y + box.height,
      );
    if (hit) {
      setSelectedBoxId(hit.id);
      return;
    }
    setSelectedBoxId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
  }

  function moveBox(event: React.PointerEvent) {
    if (!draft) return;
    const point = pointerPosition(event);
    if (!point) return;
    setDraft({
      ...draft,
      x: Math.min(draft.startX, point.x),
      y: Math.min(draft.startY, point.y),
      width: Math.abs(point.x - draft.startX),
      height: Math.abs(point.y - draft.startY),
    });
  }

  function finishBox(event: React.PointerEvent) {
    if (!draft || !active) return;
    if (draft.width > 0.008 && draft.height > 0.008) {
      setPendingBox({
        id: crypto.randomUUID(),
        imageId: active.id,
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height,
      });
      setClassSearch("");
    }
    setDraft(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  function addClass() {
    const value = newClass.trim();
    if (!value) return;
    if (!classes.includes(value)) setClasses((current) => [...current, value]);
    setNewClass("");
  }

  function parseClasses(value: string) {
    let values: unknown = value;
    try {
      values = JSON.parse(value);
    } catch {
      /* accept text and CSV */
    }
    const raw = Array.isArray(values) ? values : String(values).split(/[\n,]+/);
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }

  function importClasses(value = bulkClasses) {
    const imported = parseClasses(value);
    if (!imported.length) return;
    setClasses((current) => Array.from(new Set([...current, ...imported])));
    setBulkClasses("");
  }

  function assignPendingBox(className: string) {
    if (!pendingBox) return;
    const { imageId, ...geometry } = pendingBox;
    const box: Box = { ...geometry, className };
    setImages((current) =>
      current.map((image) =>
        image.id === imageId
          ? { ...image, boxes: [...image.boxes, box] }
          : image,
      ),
    );
    setPendingBox(null);
    setClassSearch("");
  }

  function addReferenceFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!accepted.length) return;
    const added = accepted.map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    if (referenceUploadTarget && !referenceClass.trim()) {
      setReferences((current) =>
        current.map((item) =>
          item.id === referenceUploadTarget
            ? { ...item, images: [...item.images, ...added] }
            : item,
        ),
      );
      setReferenceUploadTarget(null);
      return;
    }
    const className = referenceClass.trim();
    if (!className) {
      added.forEach((image) => URL.revokeObjectURL(image.url));
      return;
    }
    setReferences((current) => {
      const existing = current.find((item) => item.className === className);
      return existing
        ? current.map((item) =>
            item.id === existing.id
              ? { ...item, images: [...item.images, ...added] }
              : item,
          )
        : [...current, { id: crypto.randomUUID(), className, images: added }];
    });
    setClasses((current) =>
      current.includes(className) ? current : [...current, className],
    );
    setReferenceClass("");
  }

  function chooseMoreProductImages(productId: string) {
    setReferenceClass("");
    setReferenceUploadTarget(productId);
    referenceFileRef.current?.click();
  }

  function removeReference(id: string) {
    setReferences((current) => {
      const target = current.find((item) => item.id === id);
      target?.images.forEach((image) => URL.revokeObjectURL(image.url));
      return current.filter((item) => item.id !== id);
    });
  }

  async function runAutoMatch() {
    if (
      !images.length ||
      !references.length ||
      !selectedModelIds.length ||
      autoMatching
    )
      return;
    setAutoMatching(true);
    setAutoError(null);
    try {
      setAutoProgress("Uploading temporary products and target images…");
      const launch = await startTemporaryLabelSession({
        projectId,
        modelIds: selectedModelIds,
        confidence,
        iou,
        threshold: matchThreshold,
        references: references.map((item) => ({
          className: item.className,
          files: item.images.map((entry) => entry.file),
        })),
        targets: images.map((image) => image.file),
      });
      setColabToken(launch.token);
      setConfigUrl(launch.config_url);
      setAutoProgress(
        "Colab opened — paste Config URL and choose Runtime → Run all.",
      );
      window.open(launch.colab_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setAutoError(
        error instanceof Error ? error.message : "Auto matching failed",
      );
    } finally {
      setAutoMatching(false);
    }
  }

  useEffect(() => {
    if (!colabToken) return;
    let stopped = false;
    const poll = async () => {
      try {
        const session = await getTemporaryLabelSession(colabToken);
        if (stopped) return;
        setRemoteSession(session);
        setAutoProgress(session.message);
        if (session.status === "completed") {
          setImages((current) =>
            current.map((image) => {
              const result = session.results.find(
                (item) =>
                  item.file_name.replace(/^\d+_/, "") === image.file.name ||
                  item.file_name.endsWith(image.file.name),
              );
              if (!result) return image;
              return {
                ...image,
                boxes: result.detections.map((detection) => ({
                  id: crypto.randomUUID(),
                  className: detection.class_name,
                  confidence: detection.matcher_score ?? detection.confidence,
                  source:
                    detection.source === "reference_matcher"
                      ? "reference_matcher"
                      : "yolo",
                  x: detection.x - detection.width / 2,
                  y: detection.y - detection.height / 2,
                  width: detection.width,
                  height: detection.height,
                })),
              };
            }),
          );
          return;
        }
      } catch (error) {
        if (!stopped)
          setAutoError(
            error instanceof Error
              ? error.message
              : "Could not read Colab progress",
          );
      }
      if (!stopped) window.setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [colabToken]);

  function removeImage(id: string) {
    const index = images.findIndex((image) => image.id === id);
    const target = images[index];
    if (target) URL.revokeObjectURL(target.url);
    const next = images.filter((image) => image.id !== id);
    setImages(next);
    if (activeId === id)
      setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  async function loadBitmap(file: File) {
    return createImageBitmap(file);
  }

  async function canvasBlob(bitmap: ImageBitmap, box: Box) {
    const sx = Math.round(box.x * bitmap.width),
      sy = Math.round(box.y * bitmap.height);
    const sw = Math.max(1, Math.round(box.width * bitmap.width)),
      sh = Math.max(1, Math.round(box.height * bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Crop could not be created")),
        "image/jpeg",
        0.94,
      ),
    );
  }

  async function exportDataset() {
    if (!images.length) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      const imageFolder = zip.folder("images")!,
        cropFolder = zip.folder("crops")!,
        yoloFolder = zip.folder("labels_yolo")!,
        vocFolder = zip.folder("labels_voc")!;
      zip.file("classes.txt", classes.join("\n"));
      const manifest: object[] = [];
      for (const image of images) {
        const stem = safeName(baseName(image.file.name));
        imageFolder.file(image.file.name, image.file);
        const bitmap = await loadBitmap(image.file);
        const yoloLines: string[] = [];
        for (let i = 0; i < image.boxes.length; i++) {
          const box = image.boxes[i];
          const classIndex = Math.max(0, classes.indexOf(box.className));
          yoloLines.push(
            `${classIndex} ${(box.x + box.width / 2).toFixed(6)} ${(box.y + box.height / 2).toFixed(6)} ${box.width.toFixed(6)} ${box.height.toFixed(6)}`,
          );
          cropFolder.file(
            `${stem}_${String(i + 1).padStart(3, "0")}_${safeName(box.className)}.jpg`,
            await canvasBlob(bitmap, box),
          );
        }
        bitmap.close();
        yoloFolder.file(`${stem}.txt`, yoloLines.join("\n"));
        const objects = image.boxes
          .map(
            (box) =>
              `<object><name>${escapeXml(box.className)}</name><pose>Unspecified</pose><truncated>0</truncated><difficult>0</difficult><bndbox><xmin>${Math.round(box.x * image.width)}</xmin><ymin>${Math.round(box.y * image.height)}</ymin><xmax>${Math.round((box.x + box.width) * image.width)}</xmax><ymax>${Math.round((box.y + box.height) * image.height)}</ymax></bndbox></object>`,
          )
          .join("");
        vocFolder.file(
          `${stem}.xml`,
          `<?xml version="1.0"?><annotation><folder>images</folder><filename>${escapeXml(image.file.name)}</filename><size><width>${image.width}</width><height>${image.height}</height><depth>3</depth></size>${objects}</annotation>`,
        );
        manifest.push({
          image: image.file.name,
          width: image.width,
          height: image.height,
          annotations: image.boxes,
        });
      }
      zip.file(
        "annotations.json",
        JSON.stringify({ classes, images: manifest }, null, 2),
      );
      zip.file(
        "README.txt",
        "Export contains original images, cropped objects, YOLO TXT labels, Pascal VOC XML labels, classes.txt and annotations.json.\nYOLO coordinates are normalized.",
      );
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `manual-label-dataset-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExporting(false);
    }
  }

  async function buildTrainingZip() {
    const zip = new JSZip();
    const imageFolder = zip.folder("images/train")!;
    const labelFolder = zip.folder("labels/train")!;
    const trainingClasses = Array.from(new Set([...classes, ...images.flatMap((image) => image.boxes.map((box) => box.className))]));
    for (const image of images) {
      imageFolder.file(image.file.name, image.file);
      labelFolder.file(`${safeName(baseName(image.file.name))}.txt`, image.boxes.map((box) => `${Math.max(0, trainingClasses.indexOf(box.className))} ${(box.x + box.width / 2).toFixed(6)} ${(box.y + box.height / 2).toFixed(6)} ${box.width.toFixed(6)} ${box.height.toFixed(6)}`).join("\n"));
    }
    zip.file("data.yaml", `path: .\ntrain: images/train\nval: images/train\nnc: ${trainingClasses.length}\nnames:\n${trainingClasses.map((name, index) => `  ${index}: ${JSON.stringify(name)}`).join("\n")}\n`);
    return zip.generateAsync({ type: "blob" });
  }

  async function trainNow() {
    if (!images.length || !boxCount || training) return;
    const colabWindow = window.open("about:blank", "_blank");
    if (colabWindow) {
      colabWindow.opener = null;
      colabWindow.document.title = "Preparing Google Colab…";
      colabWindow.document.body.textContent = "Preparing training dataset…";
    }
    setTraining(true); setAutoError(null);
    try {
      const launch = await startTemporaryTraining({ projectId, datasetZip: await buildTrainingZip(), epochs: 50, imageSize: 640 });
      setTrainingToken(launch.token); setTrainingConfigUrl(launch.config_url);
      if (colabWindow && !colabWindow.closed) colabWindow.location.replace(launch.colab_url);
      else window.location.assign(launch.colab_url);
    } catch (error) {
      if (colabWindow && !colabWindow.closed) colabWindow.close();
      setAutoError(error instanceof Error ? error.message : "Training launch failed");
    }
    finally { setTraining(false); }
  }

  async function closeSession() {
    images.forEach((image) => URL.revokeObjectURL(image.url));
    references.forEach((reference) =>
      reference.images.forEach((image) => URL.revokeObjectURL(image.url)),
    );
    if (colabToken)
      await deleteTemporaryLabelSession(colabToken).catch(() => undefined);
    if (trainingToken)
      await deleteTemporaryLabelSession(trainingToken).catch(() => undefined);
    setImages([]);
    setClasses([]);
    setReferences([]);
    setActiveId(null);
    setPendingBox(null);
    setConfirmClose(false);
    setProductsSubmitted(false);
    setToolMode(null);
    setColabToken(null);
    setConfigUrl(null);
    setRemoteSession(null);
    setTrainingToken(null);
    setTrainingConfigUrl(null);
    await deleteSession(projectId).catch(() => {
      /* state is still cleared in this tab */
    });
  }

  if (!hydrated)
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-3xl border border-slate-200 bg-white/70">
        <p className="text-sm font-medium text-slate-500">
          Restoring Label Tool session…
        </p>
      </div>
    );

  if (!toolMode)
    return (
      <div className="space-y-6">
        <div className="text-center">
          <span className="inline-flex rounded-2xl bg-emerald-100 p-4 text-emerald-700">
            <Scissors className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            Choose labeling mode
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Manual aur Colab Auto Label dono available hain.
          </p>
        </div>
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          <button
            onClick={() => {
              setToolMode("manual");
              setProductsSubmitted(true);
            }}
            className="group rounded-3xl border-2 border-slate-200 bg-white p-7 text-left shadow-sm transition hover:-translate-y-1 hover:border-emerald-400 hover:shadow-lg"
          >
            <span className="inline-flex rounded-2xl bg-emerald-100 p-3 text-emerald-700">
              <Scissors className="h-7 w-7" />
            </span>
            <h2 className="mt-5 text-xl font-bold">Manual Label</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Images upload karein, manually boxes draw karein aur searchable
              modal se class assign karein.
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-emerald-700">
              Open Manual Label <ChevronRight className="h-4 w-4" />
            </span>
          </button>
          <button
            onClick={() => {
              setToolMode("auto");
              setProductsSubmitted(false);
            }}
            className="group rounded-3xl border-2 border-slate-200 bg-white p-7 text-left shadow-sm transition hover:-translate-y-1 hover:border-violet-400 hover:shadow-lg"
          >
            <span className="inline-flex rounded-2xl bg-violet-100 p-3 text-violet-700">
              <Sparkles className="h-7 w-7" />
            </span>
            <h2 className="mt-5 text-xl font-bold">
              Auto Label with New Products
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              New product references submit karein; Colab YOLO aur visual
              matching se boxes/classes lagayega.
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-violet-700">
              Open Auto Label <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    );

  if (toolMode === "auto" && !productsSubmitted)
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-violet-100 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
              <Sparkles className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold">Step 1 — Add new products</h1>
              <p className="mt-1 text-sm text-slate-500">
                Each product has one class and one or more reference photos.
                Nothing is saved to Supabase.
              </p>
            </div>
          </div>
          <div className="mt-6 flex max-w-xl flex-col gap-2 sm:flex-row">
            <input
              value={referenceClass}
              onChange={(e) => setReferenceClass(e.target.value)}
              placeholder="Product class, e.g. pepsi_500ml"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <Button
              disabled={!referenceClass.trim()}
              onClick={() => {
                setReferenceUploadTarget(null);
                referenceFileRef.current?.click();
              }}
            >
              <ImagePlus className="h-4 w-4" />
              Select multiple photos
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            File picker mein Ctrl/Shift se multiple images ek saath select
            karein.
          </p>
        </div>
        {references.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {references.map((reference) => (
              <div
                key={reference.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-bold">{reference.className}</h2>
                  <button
                    onClick={() => removeReference(reference.id)}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reference.images.map((image) => (
                    <img
                      key={image.id}
                      src={image.url}
                      alt=""
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                  ))}
                </div>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => chooseMoreProductImages(reference.id)}
                >
                  <Plus className="h-4 w-4" />
                  Add more images
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => setToolMode(null)}>
            <ChevronLeft className="h-4 w-4" />
            Back to modes
          </Button>
          <Button
            disabled={!references.length}
            onClick={() => setProductsSubmitted(true)}
          >
            Submit {references.length} product
            {references.length === 1 ? "" : "s"} & continue
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <input
          ref={referenceFileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addReferenceFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-white/80 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
              <Scissors className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">
              {toolMode === "manual" ? "Manual Label & Crop Tool" : "Auto Label with New Products"}
            </h1>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Upload images, draw boxes, and export every crop with YOLO TXT and
            Pascal VOC XML labels.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setToolMode(null)}
            disabled={autoMatching || remoteSession?.status === "running"}
          >
            <ChevronLeft className="h-4 w-4" />
            Switch mode
          </Button>
          <span className="mr-1 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            {saveState === "saving" ? "Auto-saving…" : "Session saved"}
          </span>
          {images.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => setConfirmClose(true)}
              className="!border-red-200 !text-red-600 hover:!bg-red-50"
            >
              <X className="h-4 w-4" />
              Close session
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void trainNow()}
            disabled={!images.length || boxCount === 0 || training}
            loading={training}
            className="!border-violet-300 !text-violet-700 hover:!bg-violet-50"
          >
            {!training && <Sparkles className="h-4 w-4" />}
            {training ? "Preparing training…" : "Train Now"}
          </Button>
          <Button
            onClick={exportDataset}
            disabled={!images.length}
            loading={exporting}
          >
            {!exporting && <Download className="h-4 w-4" />}
            {exporting ? "Building ZIP…" : "Download complete ZIP"}
          </Button>
        </div>
      </div>

      {trainingConfigUrl && (
        <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4">
          <h2 className="text-sm font-bold text-violet-950">Training Colab opened</h2>
          <p className="mt-1 text-xs text-violet-700">Config URL copy karke Colab mein paste karein, phir Runtime → Run all. Dataset automatically upload ho chuka hai.</p>
          <div className="mt-3 flex gap-2"><input readOnly value={trainingConfigUrl} className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs" /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(trainingConfigUrl)}>Copy Config URL</Button></div>
        </div>
      )}

      {toolMode === "auto" && images.length > 0 && (
        <section className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-cyan-50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" />
                <h2 className="text-sm font-bold">Auto Reference Match</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Enter a product class and add one or more clear reference
                photos. Files stay only in this browser.
              </p>
              <div className="mt-3 flex max-w-md gap-2">
                <input
                  value={referenceClass}
                  onChange={(e) => setReferenceClass(e.target.value)}
                  placeholder="Product class, e.g. pepsi_500ml"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <Button
                  variant="secondary"
                  disabled={!referenceClass.trim()}
                  onClick={() => referenceFileRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  Add photos
                </Button>
              </div>
            </div>
            <div className="w-full lg:w-64">
              <label className="block text-xs font-medium text-slate-600">
                Match threshold: {Math.round(matchThreshold * 100)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.01"
                value={matchThreshold}
                onChange={(e) => setMatchThreshold(Number(e.target.value))}
                className="mt-1 w-full accent-violet-600"
              />
              <Button
                onClick={() => void runAutoMatch()}
                disabled={!references.length || autoMatching}
                loading={autoMatching}
                className="mt-2 w-full !bg-violet-600 hover:!bg-violet-700"
              >
                {!autoMatching && <Sparkles className="h-4 w-4" />}
                {autoMatching ? "Matching…" : "Auto label all images"}
              </Button>
            </div>
          </div>
          {references.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {references.map((reference) => (
                <div
                  key={reference.id}
                  className="flex items-center gap-2 rounded-xl border border-white bg-white/85 p-2 shadow-sm"
                >
                  <div className="flex -space-x-2">
                    {reference.images.slice(0, 3).map((image) => (
                      <img
                        key={image.id}
                        src={image.url}
                        alt=""
                        className="h-8 w-8 rounded-lg border-2 border-white object-cover"
                      />
                    ))}
                  </div>
                  <span className="text-xs font-semibold">
                    {reference.className} ({reference.images.length})
                  </span>
                  <button
                    onClick={() => removeReference(reference.id)}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {autoProgress && (
            <p className="mt-3 text-xs font-medium text-violet-700">
              {autoProgress}
            </p>
          )}
          {autoError && (
            <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-600">
              {autoError}
            </p>
          )}
        </section>
      )}

      {toolMode === "auto" && references.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Reference product groups
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Every class is a separate product. Select multiple files
                together, or add more images later.
              </p>
            </div>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">
              {references.length} products
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {references.map((reference) => (
              <div
                key={reference.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {reference.className}
                  </p>
                  <button
                    onClick={() => removeReference(reference.id)}
                    className="text-slate-400 hover:text-red-500"
                    title="Remove this product"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reference.images.map((image) => (
                    <img
                      key={image.id}
                      src={image.url}
                      alt={reference.className}
                      className="h-12 w-12 rounded-lg border border-white object-cover shadow-sm"
                    />
                  ))}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => chooseMoreProductImages(reference.id)}
                  className="mt-3 w-full text-xs"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Add more images
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-medium text-violet-700">
            Another product add karne ke liye upar different class name likhein,
            phir multiple photos select karein.
          </p>
        </section>
      )}

      {selectedBox && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-emerald-700">
              Selected box class
            </p>
            <p className="truncate text-sm font-bold text-emerald-950">
              {selectedBox.className}
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {selectedBox.source === "reference_matcher"
              ? `Auto match · ${Math.round((selectedBox.confidence ?? 0) * 100)}%`
              : "Manual"}
          </span>
          <button
            onClick={() => setSelectedBoxId(null)}
            className="text-emerald-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {toolMode === "auto" && images.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold">Colab models & settings</h2>
              <p className="mt-1 text-xs text-slate-500">
                YOLO finds boxes; submitted products refine final classes.
              </p>
            </div>
            <button
              onClick={() => setProductsSubmitted(false)}
              disabled={Boolean(colabToken)}
              className="text-xs font-semibold text-violet-700 disabled:opacity-40"
            >
              Edit products
            </button>
          </div>
          <div className="mt-4">
            <ModelMultiSelect
              models={models}
              selectedIds={selectedModelIds}
              onChange={setSelectedModelIds}
              disabled={Boolean(colabToken)}
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-medium">
              YOLO confidence: {confidence.toFixed(2)}
              <input
                type="range"
                min="0.05"
                max="0.9"
                step="0.05"
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="mt-2 w-full"
              />
            </label>
            <label className="text-xs font-medium">
              IoU: {iou.toFixed(2)}
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={iou}
                onChange={(e) => setIou(Number(e.target.value))}
                className="mt-2 w-full"
              />
            </label>
            <label className="text-xs font-medium">
              Product match: {matchThreshold.toFixed(2)}
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.01"
                value={matchThreshold}
                onChange={(e) => setMatchThreshold(Number(e.target.value))}
                className="mt-2 w-full"
              />
            </label>
          </div>
          {configUrl && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold">
                Copy this Config URL into Colab
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={configUrl}
                  className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-xs"
                />
                <Button
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(configUrl)}
                >
                  Copy
                </Button>
              </div>
            </div>
          )}
          {remoteSession && (
            <div className="mt-4">
              <div className="flex justify-between text-xs">
                <span>{remoteSession.message}</span>
                <span>
                  {remoteSession.processed}/{remoteSession.total}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-violet-600"
                  style={{
                    width: `${remoteSession.total ? (remoteSession.processed / remoteSession.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {!images.length ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={`flex min-h-[28rem] w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-white/70 p-8 transition ${dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40"}`}
        >
          <span className="rounded-2xl bg-gradient-to-br from-emerald-100 to-cyan-100 p-5 text-emerald-700">
            <UploadCloud className="h-10 w-10" />
          </span>
          <span className="mt-4 text-lg font-semibold">Drop images here</span>
          <span className="mt-1 text-sm text-slate-500">
            or click to browse · JPG, PNG, WEBP and more
          </span>
        </button>
      ) : (
        <div className="grid min-h-[38rem] gap-4 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Images</p>
                <p className="text-xs text-slate-400">
                  {images.length} files · {boxCount} boxes
                </p>
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                className="rounded-lg bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"
                title="Add images"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[34rem] space-y-2 overflow-y-auto">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  onClick={() => setActiveId(image.id)}
                  className={`group flex w-full items-center gap-2 rounded-xl border p-2 text-left ${image.id === activeId ? "border-emerald-400 bg-emerald-50" : "border-transparent bg-slate-50 hover:border-slate-200"}`}
                >
                  <img
                    src={image.url}
                    alt=""
                    className="h-12 w-12 rounded-lg object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {index + 1}. {image.file.name}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {image.boxes.length} crops
                    </span>
                  </span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(image.id);
                    }}
                    className="hidden text-slate-400 hover:text-red-500 group-hover:block"
                  >
                    <X className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-slate-300">
              <span className="truncate text-sm">{active?.file.name}</span>
              <span className="text-xs text-slate-500">
                Drag on image to create crop box
              </span>
            </div>
            <div
              ref={stageRef}
              className="relative flex min-h-[32rem] flex-1 items-center justify-center overflow-hidden p-3"
            >
              {active && (
                <div
                  className="relative max-h-full max-w-full touch-none select-none"
                  onPointerDown={startBox}
                  onPointerMove={moveBox}
                  onPointerUp={finishBox}
                >
                  <img
                    ref={imageRef}
                    src={active.url}
                    alt={active.file.name}
                    draggable={false}
                    className="block max-h-[calc(100dvh-17rem)] max-w-full object-contain"
                  />
                  {active.boxes.map((box, i) => {
                    const color =
                      COLORS[classes.indexOf(box.className) % COLORS.length] ||
                      COLORS[0];
                    return (
                      <div
                        key={box.id}
                        className="absolute border-2"
                        style={{
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                          borderColor: color,
                          backgroundColor: `${color}18`,
                        }}
                      >
                        <span
                          className="absolute -top-6 left-[-2px] rounded-t px-1.5 py-0.5 text-[10px] font-bold text-white"
                          style={{ backgroundColor: color }}
                        >
                          {i + 1} · {box.className}
                        </span>
                      </div>
                    );
                  })}
                  {draft && (
                    <div
                      className="pointer-events-none absolute border-2 border-dashed border-cyan-400 bg-cyan-400/10"
                      style={{
                        left: `${draft.x * 100}%`,
                        top: `${draft.y * 100}%`,
                        width: `${draft.width * 100}%`,
                        height: `${draft.height * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-3 border-t border-slate-800 p-2">
              <Button
                variant="secondary"
                onClick={() =>
                  activeIndex > 0 && setActiveId(images[activeIndex - 1].id)
                }
                disabled={activeIndex <= 0}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <span className="text-xs text-slate-400">
                {activeIndex + 1} / {images.length}
              </span>
              <Button
                variant="secondary"
                onClick={() =>
                  activeIndex < images.length - 1 &&
                  setActiveId(images[activeIndex + 1].id)
                }
                disabled={activeIndex >= images.length - 1}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </main>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold">Class library</h2>
              <p className="mt-1 text-xs text-slate-400">
                Paste a JSON array, comma list, or one class per line.
              </p>
              <textarea
                value={bulkClasses}
                onChange={(e) => setBulkClasses(e.target.value)}
                placeholder={'["person", "car", "bottle"]'}
                rows={3}
                className="mt-3 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  className="text-xs"
                  onClick={() => classFileRef.current?.click()}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Upload file
                </Button>
                <Button
                  className="text-xs"
                  onClick={() => importClasses()}
                  disabled={!bulkClasses.trim()}
                >
                  Import classes
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addClass()}
                  placeholder="Add one class"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={addClass}
                  className="rounded-lg bg-slate-900 p-2 text-white"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-500">
                {classes.length} classes loaded
              </p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">
                  Crops ({active?.boxes.length ?? 0})
                </h2>
                {active?.boxes.length ? (
                  <button
                    onClick={() =>
                      setImages((current) =>
                        current.map((image) =>
                          image.id === active.id
                            ? { ...image, boxes: [] }
                            : image,
                        ),
                      )
                    }
                    className="text-xs text-red-500"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {active?.boxes.map((box, i) => (
                  <div
                    key={box.id}
                    className="flex items-center gap-2 rounded-xl bg-slate-50 p-2"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-700">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {box.className}
                    </span>
                    <button
                      onClick={() =>
                        setImages((current) =>
                          current.map((image) =>
                            image.id === active.id
                              ? {
                                  ...image,
                                  boxes: image.boxes.filter(
                                    (item) => item.id !== box.id,
                                  ),
                                }
                              : image,
                          ),
                        )
                      }
                      className="text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {!active?.boxes.length && (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    Draw a rectangle over an object to add your first crop.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
      {pendingBox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Select class for box"
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Assign a class
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Select the class for this box. The box saves after selection.
                </p>
              </div>
              <button
                onClick={() => setPendingBox(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cancel box"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={classSearch}
                  onChange={(e) => setClassSearch(e.target.value)}
                  placeholder="Search classes…"
                  className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-3 text-sm"
                />
              </div>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                {filteredClasses.map((name, i) => (
                  <button
                    key={name}
                    onClick={() => assignPendingBox(name)}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50"
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor:
                          COLORS[classes.indexOf(name) % COLORS.length],
                      }}
                    />
                    <span className="flex-1 text-sm font-semibold text-slate-700">
                      {name}
                    </span>
                    <span className="text-xs text-slate-400">Select</span>
                  </button>
                ))}
                {classes.length === 0 && (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-5 text-center text-sm text-amber-800">
                    No classes loaded. Cancel this box and import your class
                    array from the Class library first.
                  </div>
                )}
                {classes.length > 0 && filteredClasses.length === 0 && (
                  <p className="p-5 text-center text-sm text-slate-400">
                    No class matches “{classSearch}”.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmClose && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Close labeling session"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Trash2 className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-center text-lg font-bold">
              Close and clear this session?
            </h2>
            <p className="mt-2 text-center text-sm text-slate-500">
              All uploaded images, boxes, and imported classes will be
              permanently removed from this browser. Make sure you downloaded
              the ZIP first.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmClose(false)}
              >
                Keep working
              </Button>
              <Button
                onClick={() => void closeSession()}
                className="!bg-red-600 hover:!bg-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Yes, clear all
              </Button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={classFileRef}
        type="file"
        accept=".txt,.json,.csv,text/plain,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) importClasses(await file.text());
          e.target.value = "";
        }}
      />
      <input
        ref={referenceFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addReferenceFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
