import { createClient } from "@/lib/supabase/server";
import { requireProject } from "@/lib/server/auth";
import { ClassManager } from "@/components/classes/class-manager";

export default async function ClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProject(id);

  const supabase = await createClient();
  const { data: classes } = await supabase
    .from("classes")
    .select("*")
    .eq("project_id", id)
    .order("sort_order", { ascending: true });

  return <ClassManager projectId={id} classes={classes ?? []} />;
}
