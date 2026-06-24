"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnnotationEditor } from "@/components/annotations/annotation-editor";
import {
  saveAnnotations,
  setReviewStatus,
} from "@/lib/actions/annotations";
import type { AnnotationBox, ReviewFilter } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface AnnotationEditorClientProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  fileId: string;
  fileName: string;
  imageUrl: string;
  initialBoxes: AnnotationBox[];
  classes: Class[];
  filter: ReviewFilter;
  prevFileId: string | null;
  nextFileId: string | null;
}

export function AnnotationEditorClient({
  projectId,
  datasetId,
  datasetName,
  fileId,
  fileName,
  imageUrl,
  initialBoxes,
  classes,
  filter,
  prevFileId,
  nextFileId,
}: AnnotationEditorClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reviewBase = `/projects/${projectId}/datasets/${datasetId}/review`;
  const filterQuery = filter !== "all" ? `?filter=${filter}` : "";

  const navigateTo = useCallback(
    (targetId: string | null) => {
      if (!targetId) return;
      router.push(`${reviewBase}/${targetId}?filter=${filter}`);
    },
    [router, reviewBase, filter]
  );

  async function persist(
    boxes: AnnotationBox[],
    action: "save" | "approve" | "reject"
  ) {
    setSaving(true);
    setError(null);

    let result;
    if (action === "save") {
      result = await saveAnnotations(projectId, datasetId, fileId, boxes);
    } else {
      result = await setReviewStatus(
        projectId,
        datasetId,
        fileId,
        action === "approve" ? "approved" : "rejected",
        boxes
      );
    }

    if (result?.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setSaving(false);
    if (action !== "save" && nextFileId) {
      navigateTo(nextFileId);
    } else {
      router.refresh();
    }
  }

  if (classes.length === 0) {
    return (
      <Alert variant="error">
        Add at least one class in{" "}
        <Link
          href={`/projects/${projectId}/classes`}
          className="underline"
        >
          Classes
        </Link>{" "}
        before annotating.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`${reviewBase}${filterQuery}`}>
          <Button variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Back to queue
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{datasetName}</h1>
          <p className="text-sm text-slate-500">Annotation editor</p>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <AnnotationEditor
        imageUrl={imageUrl}
        fileName={fileName}
        initialBoxes={initialBoxes}
        classes={classes}
        saving={saving}
        onSave={(boxes) => persist(boxes, "save")}
        onApprove={(boxes) => persist(boxes, "approve")}
        onReject={(boxes) => persist(boxes, "reject")}
        onPrev={() => navigateTo(prevFileId)}
        onNext={() => navigateTo(nextFileId)}
        hasPrev={!!prevFileId}
        hasNext={!!nextFileId}
      />
    </div>
  );
}
