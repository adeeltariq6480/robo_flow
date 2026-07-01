import { Suspense } from "react";
import Link from "next/link";
import {
  getDatasetReviewQueue,
  getReviewCounts,
} from "@/lib/actions/annotations";
import { getProject } from "@/lib/server/auth";
import * as datasetService from "@/lib/services/datasetService";
import * as classService from "@/lib/services/classService";
import { AnnotationReviewQueue } from "@/components/annotations/annotation-review-queue";
import { Button } from "@/components/ui/button";
import type { ReviewFilter } from "@/lib/types/annotations";
import { ArrowLeft, Download } from "lucide-react";
import { notFound } from "next/navigation";

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

async function ReviewContent({
  projectId,
  datasetId,
  filter,
}: {
  projectId: string;
  datasetId: string;
  filter: ReviewFilter;
}) {
  const dataset = await datasetService.getDataset(projectId, datasetId);
  if (!dataset) notFound();

  const [queueResult, countsResult, classes] = await Promise.all([
    getDatasetReviewQueue(projectId, datasetId, filter),
    getReviewCounts(projectId, datasetId),
    classService.listClasses(projectId),
  ]);

  if (queueResult.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load review queue: {queueResult.error}
      </p>
    );
  }

  const counts = countsResult.counts ?? {
    all: 0,
    needs_review: 0,
    unannotated: 0,
    annotated: 0,
    approved: 0,
    rejected: 0,
  };

  return (
    <AnnotationReviewQueue
      projectId={projectId}
      datasetId={datasetId}
      datasetName={dataset.name}
      classes={classes}
      files={queueResult.files ?? []}
      counts={counts}
      activeFilter={filter}
    />
  );
}

export default async function DatasetReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; datasetId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { id: projectId, datasetId } = await params;
  const { filter: filterParam } = await searchParams;
  await getProject(projectId);

  const filter = parseFilter(filterParam);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${projectId}/datasets`}>
          <Button variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Datasets
          </Button>
        </Link>
        <Link href={`/projects/${projectId}/datasets/${datasetId}/export`}>
          <Button variant="secondary">
            <Download className="h-4 w-4" />
            Export approved
          </Button>
        </Link>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-slate-500">Loading review queue…</p>
        }
      >
        <div className="mt-4">
          <ReviewContent
            projectId={projectId}
            datasetId={datasetId}
            filter={filter}
          />
        </div>
      </Suspense>
    </div>
  );
}
