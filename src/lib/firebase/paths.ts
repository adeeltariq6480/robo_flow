/** Firestore collection path helpers. */

export const COLLECTIONS = {
  users: "users",
  projects: "projects",
} as const;

export const PROJECT_SUB = {
  classes: "classes",
  datasets: "datasets",
  images: "images",
  models: "models",
  modelTestRuns: "modelTestRuns",
  modelComparisonResults: "modelComparisonResults",
  labellingJobs: "labellingJobs",
  annotations: "annotations",
  annotationObjects: "annotationObjects",
  reviewQueues: "reviewQueues",
  exportJobs: "exportJobs",
  auditLogs: "auditLogs",
} as const;

export function projectPath(projectId: string) {
  return `${COLLECTIONS.projects}/${projectId}`;
}

export function projectSub(projectId: string, sub: string) {
  return `${projectPath(projectId)}/${sub}`;
}

/** Firebase Storage paths */
export function storageImagePath(
  projectId: string,
  datasetId: string,
  fileName: string
) {
  const safe = fileName.replace(/[^\w.\-()+ ]/g, "_") || "image.jpg";
  return `projects/${projectId}/datasets/${datasetId}/images/${crypto.randomUUID()}-${safe}`;
}

export function storageModelPath(projectId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.\-()+ ]/g, "_") || "model.pt";
  return `projects/${projectId}/models/${crypto.randomUUID()}-${safe}`;
}

export function storageExportPath(
  projectId: string,
  exportJobId: string,
  ext: string
) {
  return `projects/${projectId}/exports/${exportJobId}.${ext}`;
}
