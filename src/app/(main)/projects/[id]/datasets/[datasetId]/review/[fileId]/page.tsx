import {
  getDatasetFileForReview,
  getDatasetReviewQueue,
} from "@/lib/actions/annotations";
import { getProject } from "@/lib/server/auth";
import * as datasetService from "@/lib/services/datasetService";
import * as classService from "@/lib/services/classService";
import { AnnotationEditorClient } from "@/components/annotations/annotation-editor-client";
import type { ReviewFilter } from "@/lib/types/annotations";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { runBackendPage } from "@/lib/server/backend-page";

const VALID_FILTERS: ReviewFilter[] = [
  "all",
  "needs_review",
  "unannotated",
  "annotated",
  "approved",
  "rejected",
];

function parseFilter(raw: string | undefined): ReviewFilter {
  if (raw && VALID_FILTERS.includes(raw as ReviewFilter)) {
    return raw as ReviewFilter;
  }
  return "all";
}

export default async function DatasetFileReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; datasetId: string; fileId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { id: projectId, datasetId, fileId } = await params;
  const { filter: filterParam } = await searchParams;
  const filter = parseFilter(filterParam);

  return runBackendPage(async () => {
    await getProject(projectId);

    const dataset = await datasetService.getDataset(projectId, datasetId);
    if (!dataset) notFound();

    const classes = await classService.listClasses(projectId);

    const fileResult = await getDatasetFileForReview(
      projectId,
      datasetId,
      fileId
    );

    if (fileResult.error || !fileResult.file || !fileResult.imageUrl) {
      return (
        <div className="space-y-4">
          <Link href={`/projects/${projectId}/datasets/${datasetId}/review`}>
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <p className="text-sm text-red-600">
            {fileResult.error ?? "Could not load file"}
          </p>
        </div>
      );
    }

    const queueResult = await getDatasetReviewQueue(
      projectId,
      datasetId,
      filter
    );
    const queueFiles = queueResult.files ?? [];
    const currentIndex = queueFiles.findIndex((f) => f.id === fileId);
    const prevFileId =
      currentIndex > 0 ? queueFiles[currentIndex - 1]?.id ?? null : null;
    const nextFileId =
      currentIndex >= 0 && currentIndex < queueFiles.length - 1
        ? queueFiles[currentIndex + 1]?.id ?? null
        : null;

    return (
      <AnnotationEditorClient
        projectId={projectId}
        datasetId={datasetId}
        datasetName={dataset.name}
        fileId={fileId}
        fileName={fileResult.file.file_name}
        imageUrl={fileResult.imageUrl}
        initialBoxes={fileResult.file.annotations}
        classes={classes}
        filter={filter}
        prevFileId={prevFileId}
        nextFileId={nextFileId}
      />
    );
  });
}
