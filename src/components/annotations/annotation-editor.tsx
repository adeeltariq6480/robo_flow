"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationBox } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";
import {
  clamp01,
  computeDisplayRect,
  newBoxId,
  normalizedToPixel,
  pixelToNormalized,
  type DisplayRect,
} from "@/lib/annotations/coords";
import { Button } from "@/components/ui/button";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MousePointer2,
  Plus,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";

type EditorMode = "select" | "draw";

interface AnnotationEditorProps {
  imageUrl: string;
  fileName: string;
  initialBoxes: AnnotationBox[];
  classes: Class[];
  saving?: boolean;
  onSave: (boxes: AnnotationBox[]) => void;
  onApprove: (boxes: AnnotationBox[]) => void;
  onReject: (boxes: AnnotationBox[]) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

type DragState =
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; boxId: string; startX: number; startY: number; orig: AnnotationBox }
  | {
      kind: "resize";
      boxId: string;
      handle: "se";
      startX: number;
      startY: number;
      orig: AnnotationBox;
    };

const MIN_BOX_PX = 8;

export function AnnotationEditor({
  imageUrl,
  fileName,
  initialBoxes,
  classes,
  saving = false,
  onSave,
  onApprove,
  onReject,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: AnnotationEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [boxes, setBoxes] = useState<AnnotationBox[]>(initialBoxes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("select");
  const [displayRect, setDisplayRect] = useState<DisplayRect | null>(null);
  const [draftRect, setDraftRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setBoxes(initialBoxes);
    setSelectedId(null);
  }, [initialBoxes, imageUrl]);

  const defaultClass = classes[0];

  const updateDisplayRect = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img?.naturalWidth) return;
    const rect = container.getBoundingClientRect();
    setDisplayRect(
      computeDisplayRect(
        rect.width,
        rect.height,
        img.naturalWidth,
        img.naturalHeight
      )
    );
  }, []);

  useEffect(() => {
    updateDisplayRect();
    window.addEventListener("resize", updateDisplayRect);
    return () => window.removeEventListener("resize", updateDisplayRect);
  }, [updateDisplayRect, imageUrl]);

  function clientToLocal(clientX: number, clientY: number) {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!displayRect) return;
    const target = e.target as HTMLElement;
    if (target.dataset.handle === "resize" && target.dataset.boxId) {
      const box = boxes.find((b) => b.id === target.dataset.boxId);
      if (!box) return;
      e.stopPropagation();
      const { x, y } = clientToLocal(e.clientX, e.clientY);
      dragRef.current = {
        kind: "resize",
        boxId: box.id,
        handle: "se",
        startX: x,
        startY: y,
        orig: { ...box },
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (target.dataset.boxId && mode === "select") {
      const boxId = target.dataset.boxId;
      setSelectedId(boxId);
      const box = boxes.find((b) => b.id === boxId);
      if (!box) return;
      e.stopPropagation();
      const { x, y } = clientToLocal(e.clientX, e.clientY);
      dragRef.current = {
        kind: "move",
        boxId,
        startX: x,
        startY: y,
        orig: { ...box },
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (mode === "draw") {
      const { x, y } = clientToLocal(e.clientX, e.clientY);
      dragRef.current = { kind: "draw", startX: x, startY: y };
      setDraftRect({ x, y, width: 0, height: 0 });
      setSelectedId(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      setSelectedId(null);
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !displayRect) return;
    const { x, y } = clientToLocal(e.clientX, e.clientY);

    if (drag.kind === "draw") {
      const left = Math.min(drag.startX, x);
      const top = Math.min(drag.startY, y);
      setDraftRect({
        x: left,
        y: top,
        width: Math.abs(x - drag.startX),
        height: Math.abs(y - drag.startY),
      });
      return;
    }

    if (drag.kind === "move") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const origPx = normalizedToPixel(drag.orig, displayRect);
      const next = pixelToNormalized(
        origPx.x + dx,
        origPx.y + dy,
        origPx.width,
        origPx.height,
        displayRect
      );
      setBoxes((prev) =>
        prev.map((b) => (b.id === drag.boxId ? { ...b, ...next } : b))
      );
      return;
    }

    if (drag.kind === "resize") {
      const origPx = normalizedToPixel(drag.orig, displayRect);
      const newW = Math.max(MIN_BOX_PX, x - origPx.x);
      const newH = Math.max(MIN_BOX_PX, y - origPx.y);
      const next = pixelToNormalized(origPx.x, origPx.y, newW, newH, displayRect);
      setBoxes((prev) =>
        prev.map((b) => (b.id === drag.boxId ? { ...b, ...next } : b))
      );
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "draw" && draftRect && displayRect) {
      if (draftRect.width >= MIN_BOX_PX && draftRect.height >= MIN_BOX_PX) {
        const norm = pixelToNormalized(
          draftRect.x,
          draftRect.y,
          draftRect.width,
          draftRect.height,
          displayRect
        );
        const newBox: AnnotationBox = {
          id: newBoxId(),
          class_name: defaultClass?.name ?? "object",
          project_class_id: defaultClass?.id ?? null,
          confidence: 1,
          ...norm,
        };
        setBoxes((prev) => [...prev, newBox]);
        setSelectedId(newBox.id);
        setMode("select");
      }
    }

    dragRef.current = null;
    setDraftRect(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    setBoxes((prev) => prev.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }

  function updateSelectedClass(classId: string) {
    const cls = classes.find((c) => c.id === classId);
    if (!cls || !selectedId) return;
    setBoxes((prev) =>
      prev.map((b) =>
        b.id === selectedId
          ? { ...b, project_class_id: cls.id, class_name: cls.name }
          : b
      )
    );
  }

  function addBoxAtCenter() {
    if (!displayRect || !defaultClass) return;
    const newBox: AnnotationBox = {
      id: newBoxId(),
      class_name: defaultClass.name,
      project_class_id: defaultClass.id,
      confidence: 1,
      x: 0.5,
      y: 0.5,
      width: clamp01(120 / displayRect.width),
      height: clamp01(80 / displayRect.height),
    };
    setBoxes((prev) => [...prev, newBox]);
    setSelectedId(newBox.id);
    setMode("select");
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "SELECT"
        ) {
          return;
        }
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selectedBox = boxes.find((b) => b.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
          <p className="truncate text-sm font-medium text-slate-200">{fileName}</p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant={mode === "select" ? "primary" : "secondary"}
              className="!px-2 !py-1 text-xs"
              onClick={() => setMode("select")}
              title="Select / move"
            >
              <MousePointer2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant={mode === "draw" ? "primary" : "secondary"}
              className="!px-2 !py-1 text-xs"
              onClick={() => setMode("draw")}
              title="Draw box"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="!px-2 !py-1 text-xs"
              onClick={addBoxAtCenter}
              title="Add box at center"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="!px-2 !py-1 text-xs text-red-400"
              onClick={deleteSelected}
              disabled={!selectedId}
              title="Delete selected"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt={fileName}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            onLoad={updateDisplayRect}
          />

          {displayRect && (
            <svg
              className="absolute inset-0 h-full w-full"
              style={{ pointerEvents: mode === "draw" ? "auto" : "none" }}
            >
              {boxes.map((box) => {
                const cls = classes.find((c) => c.id === box.project_class_id);
                const color = cls?.color ?? "#3b82f6";
                const px = normalizedToPixel(box, displayRect);
                const isSelected = box.id === selectedId;
                return (
                  <g key={box.id} style={{ pointerEvents: "auto" }}>
                    <rect
                      data-box-id={box.id}
                      x={px.x}
                      y={px.y}
                      width={px.width}
                      height={px.height}
                      fill={`${color}22`}
                      stroke={color}
                      strokeWidth={isSelected ? 3 : 2}
                      className="cursor-move"
                    />
                    <text
                      x={px.x + 4}
                      y={px.y + 14}
                      fill={color}
                      fontSize={12}
                      fontWeight={600}
                      style={{ pointerEvents: "none" }}
                    >
                      {box.class_name}
                    </text>
                    {isSelected && (
                      <rect
                        data-handle="resize"
                        data-box-id={box.id}
                        x={px.x + px.width - 6}
                        y={px.y + px.height - 6}
                        width={12}
                        height={12}
                        fill={color}
                        className="cursor-se-resize"
                        style={{ pointerEvents: "auto" }}
                      />
                    )}
                  </g>
                );
              })}

              {draftRect && (
                <rect
                  x={draftRect.x}
                  y={draftRect.y}
                  width={draftRect.width}
                  height={draftRect.height}
                  fill="rgba(59,130,246,0.15)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              )}
            </svg>
          )}
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Boxes ({boxes.length})
          </h3>
          {boxes.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Draw a box on the image or click + to add one.
            </p>
          ) : (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {boxes.map((box) => {
                const cls = classes.find((c) => c.id === box.project_class_id);
                return (
                  <li key={box.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(box.id);
                        setMode("select");
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                        box.id === selectedId
                          ? "bg-brand-50 text-brand-900"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded"
                        style={{ backgroundColor: cls?.color ?? "#94a3b8" }}
                      />
                      <span className="flex-1 truncate">{box.class_name}</span>
                      <span className="text-xs text-slate-400">
                        {(box.confidence * 100).toFixed(0)}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedBox && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <label className="block text-sm font-medium text-slate-700">
              Class
            </label>
            <select
              value={selectedBox.project_class_id ?? ""}
              onChange={(e) => updateSelectedClass(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={() => onSave(boxes)} disabled={saving}>
            <Save className="h-4 w-4" />
            Save annotations
          </Button>
          <Button
            variant="secondary"
            onClick={() => onApprove(boxes)}
            disabled={saving}
            className="!border-green-300 !text-green-700 hover:!bg-green-50"
          >
            <Check className="h-4 w-4" />
            Approve
          </Button>
          <Button
            variant="secondary"
            onClick={() => onReject(boxes)}
            disabled={saving}
            className="!border-red-300 !text-red-700 hover:!bg-red-50"
          >
            <X className="h-4 w-4" />
            Reject
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onPrev}
            disabled={!hasPrev}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onNext}
            disabled={!hasNext}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
