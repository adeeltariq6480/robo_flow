import Link from "next/link";
import { requireProject } from "@/lib/server/auth";
import { ModelUploadForm } from "@/components/models/model-upload-form";

export default async function ModelUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProject(id);

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/projects/${id}/models`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to models
        </Link>
      </div>
      <ModelUploadForm projectId={id} />
    </div>
  );
}
