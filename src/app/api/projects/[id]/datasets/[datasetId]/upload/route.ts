import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; datasetId: string }> }
) {
  const { id: projectId, datasetId } = await context.params;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const filePath = `${projectId}/${datasetId}/${crypto.randomUUID()}-${file.name}`;
    const supabase = createAdminClient();

    const { error } = await supabase.storage
      .from("datasets")
      .upload(filePath, file, { upsert: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      file: {
        fileName: file.name,
        filePath,
        fileSize: file.size,
        mimeType: file.type,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
