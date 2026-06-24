import { createAdminClient } from "@/lib/supabase/admin";
import { ProjectsListClient } from "@/components/projects/projects-list-client";
import type { Project } from "@/lib/types/database";

export default async function HomePage() {
  const supabase = createAdminClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  return <ProjectsListClient projects={(projects ?? []) as Project[]} />;
}
