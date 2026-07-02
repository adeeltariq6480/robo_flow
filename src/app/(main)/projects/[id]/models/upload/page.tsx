import Link from "next/link";
import { getProject } from "@/lib/server/auth";
import { ModelUploadForm } from "@/components/models/model-upload-form";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function ModelUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return runBackendPage(async () => {
    await getProject(id);

    return (
      <div>
        <Link
          href={`/projects/${id}/models`}
          className="mb-6 inline-block text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to models
        </Link>
        <ModelUploadForm projectId={id} />
      </div>
    );
  });
}
