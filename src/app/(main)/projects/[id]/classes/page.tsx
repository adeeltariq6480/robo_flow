import { createAdminClient } from "@/lib/supabase/admin";
import { getProject } from "@/lib/server/auth";
import { ClassManager } from "@/components/classes/class-manager";
import type { Class } from "@/lib/types/database";

export default async function ClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);

  const supabase = createAdminClient();
  const { data: classes } = await supabase
    .from("classes")
    .select("*")
    .eq("project_id", id)
    .order("sort_order", { ascending: true });

  return <ClassManager projectId={id} classes={(classes ?? []) as Class[]} />;
}
