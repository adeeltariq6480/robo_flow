"use client";

interface InferenceConfigProps {
  confidence: number;
  iou: number;
  onConfidenceChange: (v: number) => void;
  onIouChange: (v: number) => void;
}

export function InferenceConfigFields({
  confidence,
  iou,
  onConfidenceChange,
  onIouChange,
}: InferenceConfigProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Confidence: {confidence.toFixed(2)}
        </label>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.05}
          value={confidence}
          onChange={(e) => onConfidenceChange(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          IoU threshold: {iou.toFixed(2)}
        </label>
        <input
          type="range"
          min={0.1}
          max={0.9}
          step={0.05}
          value={iou}
          onChange={(e) => onIouChange(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
    </div>
  );
}
