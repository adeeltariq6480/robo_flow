import { ModelUploadForm } from "@/components/models/model-upload-form";
import Link from "next/link";

export default async function ModelUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
}
