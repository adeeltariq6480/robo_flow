import { getProject } from "@/lib/server/auth";
import * as classService from "@/lib/services/classService";
import { ClassManager } from "@/components/classes/class-manager";

export default async function ClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);
  const classes = await classService.listClasses(id);

  return <ClassManager projectId={id} classes={classes} />;
}
