"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Plus,
  Scissors,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Box = { id: string; x: number; y: number; width: number; height: number; className: string };
type LabelImage = { id: string; file: File; url: string; width: number; height: number; boxes: Box[] };
type Draft = { startX: number; startY: number; x: number; y: number; width: number; height: number };

const COLORS = ["#10b981", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#3b82f6"];
const safeName = (value: string) => value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "object";
const baseName = (name: string) => name.replace(/\.[^.]+$/, "");
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export function ManualLabelTool() {
  const [images, setImages] = useState<LabelImage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [classes, setClasses] = useState(["object"]);
  const [activeClass, setActiveClass] = useState("object");
  const [newClass, setNewClass] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imagesRef = useRef<LabelImage[]>([]);

  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)), []);

  const active = images.find((image) => image.id === activeId) ?? null;
  const activeIndex = active ? images.findIndex((image) => image.id === active.id) : -1;
  const boxCount = useMemo(() => images.reduce((sum, image) => sum + image.boxes.length, 0), [images]);

  async function addFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const loaded = await Promise.all(accepted.map(async (file) => {
      const url = URL.createObjectURL(file);
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = reject;
        img.src = url;
      });
      return { id: crypto.randomUUID(), file, url, ...size, boxes: [] } satisfies LabelImage;
    }));
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
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ startX: point.x, startY: point.y, x: point.x, y: point.y, width: 0, height: 0 });
  }

  function moveBox(event: React.PointerEvent) {
    if (!draft) return;
    const point = pointerPosition(event);
    if (!point) return;
    setDraft({ ...draft, x: Math.min(draft.startX, point.x), y: Math.min(draft.startY, point.y), width: Math.abs(point.x - draft.startX), height: Math.abs(point.y - draft.startY) });
  }

  function finishBox(event: React.PointerEvent) {
    if (!draft || !active) return;
    if (draft.width > 0.008 && draft.height > 0.008) {
      const box: Box = { id: crypto.randomUUID(), x: draft.x, y: draft.y, width: draft.width, height: draft.height, className: activeClass };
      setImages((current) => current.map((image) => image.id === active.id ? { ...image, boxes: [...image.boxes, box] } : image));
    }
    setDraft(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  function addClass() {
    const value = newClass.trim();
    if (!value) return;
    if (!classes.includes(value)) setClasses((current) => [...current, value]);
    setActiveClass(value);
    setNewClass("");
  }

  function removeImage(id: string) {
    const index = images.findIndex((image) => image.id === id);
    const target = images[index];
    if (target) URL.revokeObjectURL(target.url);
    const next = images.filter((image) => image.id !== id);
    setImages(next);
    if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  async function loadBitmap(file: File) {
    return createImageBitmap(file);
  }

  async function canvasBlob(bitmap: ImageBitmap, box: Box) {
    const sx = Math.round(box.x * bitmap.width), sy = Math.round(box.y * bitmap.height);
    const sw = Math.max(1, Math.round(box.width * bitmap.width)), sh = Math.max(1, Math.round(box.height * bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = sw; canvas.height = sh;
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Crop could not be created")), "image/jpeg", 0.94));
  }

  async function exportDataset() {
    if (!images.length) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      const imageFolder = zip.folder("images")!, cropFolder = zip.folder("crops")!, yoloFolder = zip.folder("labels_yolo")!, vocFolder = zip.folder("labels_voc")!;
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
          yoloLines.push(`${classIndex} ${(box.x + box.width / 2).toFixed(6)} ${(box.y + box.height / 2).toFixed(6)} ${box.width.toFixed(6)} ${box.height.toFixed(6)}`);
          cropFolder.file(`${stem}_${String(i + 1).padStart(3, "0")}_${safeName(box.className)}.jpg`, await canvasBlob(bitmap, box));
        }
        bitmap.close();
        yoloFolder.file(`${stem}.txt`, yoloLines.join("\n"));
        const objects = image.boxes.map((box) => `<object><name>${escapeXml(box.className)}</name><pose>Unspecified</pose><truncated>0</truncated><difficult>0</difficult><bndbox><xmin>${Math.round(box.x * image.width)}</xmin><ymin>${Math.round(box.y * image.height)}</ymin><xmax>${Math.round((box.x + box.width) * image.width)}</xmax><ymax>${Math.round((box.y + box.height) * image.height)}</ymax></bndbox></object>`).join("");
        vocFolder.file(`${stem}.xml`, `<?xml version="1.0"?><annotation><folder>images</folder><filename>${escapeXml(image.file.name)}</filename><size><width>${image.width}</width><height>${image.height}</height><depth>3</depth></size>${objects}</annotation>`);
        manifest.push({ image: image.file.name, width: image.width, height: image.height, annotations: image.boxes });
      }
      zip.file("annotations.json", JSON.stringify({ classes, images: manifest }, null, 2));
      zip.file("README.txt", "Export contains original images, cropped objects, YOLO TXT labels, Pascal VOC XML labels, classes.txt and annotations.json.\nYOLO coordinates are normalized.");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `manual-label-dataset-${new Date().toISOString().slice(0, 10)}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { setExporting(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-white/80 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><span className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><Scissors className="h-5 w-5" /></span><h1 className="text-xl font-bold text-slate-900">Manual Label & Crop Tool</h1></div><p className="mt-2 text-sm text-slate-500">Upload images, draw boxes, and export every crop with YOLO TXT and Pascal VOC XML labels.</p></div>
        <Button onClick={exportDataset} disabled={!images.length} loading={exporting}>{!exporting && <Download className="h-4 w-4" />}{exporting ? "Building ZIP…" : "Download complete ZIP"}</Button>
      </div>

      {!images.length ? (
        <button type="button" onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); }} className={`flex min-h-[28rem] w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-white/70 p-8 transition ${dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40"}`}>
          <span className="rounded-2xl bg-gradient-to-br from-emerald-100 to-cyan-100 p-5 text-emerald-700"><UploadCloud className="h-10 w-10" /></span><span className="mt-4 text-lg font-semibold">Drop images here</span><span className="mt-1 text-sm text-slate-500">or click to browse · JPG, PNG, WEBP and more</span>
        </button>
      ) : (
        <div className="grid min-h-[38rem] gap-4 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-3"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-bold">Images</p><p className="text-xs text-slate-400">{images.length} files · {boxCount} boxes</p></div><button onClick={() => inputRef.current?.click()} className="rounded-lg bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100" title="Add images"><ImagePlus className="h-4 w-4" /></button></div><div className="max-h-[34rem] space-y-2 overflow-y-auto">{images.map((image, index) => <button key={image.id} onClick={() => setActiveId(image.id)} className={`group flex w-full items-center gap-2 rounded-xl border p-2 text-left ${image.id === activeId ? "border-emerald-400 bg-emerald-50" : "border-transparent bg-slate-50 hover:border-slate-200"}`}><img src={image.url} alt="" className="h-12 w-12 rounded-lg object-cover" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{index + 1}. {image.file.name}</span><span className="text-[11px] text-slate-400">{image.boxes.length} crops</span></span><span role="button" onClick={(e) => { e.stopPropagation(); removeImage(image.id); }} className="hidden text-slate-400 hover:text-red-500 group-hover:block"><X className="h-4 w-4" /></span></button>)}</div></aside>

          <main className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950"><div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-slate-300"><span className="truncate text-sm">{active?.file.name}</span><span className="text-xs text-slate-500">Drag on image to create crop box</span></div><div ref={stageRef} className="relative flex min-h-[32rem] flex-1 items-center justify-center overflow-hidden p-3">{active && <div className="relative max-h-full max-w-full touch-none select-none" onPointerDown={startBox} onPointerMove={moveBox} onPointerUp={finishBox}><img ref={imageRef} src={active.url} alt={active.file.name} draggable={false} className="block max-h-[calc(100dvh-17rem)] max-w-full object-contain" />{active.boxes.map((box, i) => { const color = COLORS[classes.indexOf(box.className) % COLORS.length] || COLORS[0]; return <div key={box.id} className="absolute border-2" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, borderColor: color, backgroundColor: `${color}18` }}><span className="absolute -top-6 left-[-2px] rounded-t px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: color }}>{i + 1} · {box.className}</span></div>; })}{draft && <div className="pointer-events-none absolute border-2 border-dashed border-cyan-400 bg-cyan-400/10" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}</div>}</div><div className="flex items-center justify-center gap-3 border-t border-slate-800 p-2"><Button variant="secondary" onClick={() => activeIndex > 0 && setActiveId(images[activeIndex - 1].id)} disabled={activeIndex <= 0}><ChevronLeft className="h-4 w-4" />Prev</Button><span className="text-xs text-slate-400">{activeIndex + 1} / {images.length}</span><Button variant="secondary" onClick={() => activeIndex < images.length - 1 && setActiveId(images[activeIndex + 1].id)} disabled={activeIndex >= images.length - 1}>Next<ChevronRight className="h-4 w-4" /></Button></div></main>

          <aside className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-bold">Active class</h2><div className="mt-3 flex flex-wrap gap-2">{classes.map((name, i) => <button key={name} onClick={() => setActiveClass(name)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${name === activeClass ? "text-white shadow" : "bg-white text-slate-600"}`} style={name === activeClass ? { backgroundColor: COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length] } : {}}>{name}</button>)}</div><div className="mt-3 flex gap-2"><input value={newClass} onChange={(e) => setNewClass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addClass()} placeholder="New class name" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button onClick={addClass} className="rounded-lg bg-slate-900 p-2 text-white"><Plus className="h-4 w-4" /></button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">Crops ({active?.boxes.length ?? 0})</h2>{active?.boxes.length ? <button onClick={() => setImages((current) => current.map((image) => image.id === active.id ? { ...image, boxes: [] } : image))} className="text-xs text-red-500">Clear all</button> : null}</div><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{active?.boxes.map((box, i) => <div key={box.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-700">{i + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{box.className}</span><button onClick={() => setImages((current) => current.map((image) => image.id === active.id ? { ...image, boxes: image.boxes.filter((item) => item.id !== box.id) } : image))} className="text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button></div>)}{!active?.boxes.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Draw a rectangle over an object to add your first crop.</p>}</div></section></aside>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
