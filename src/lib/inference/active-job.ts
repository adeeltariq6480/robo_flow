"use client";

export type ActiveInferenceJob = {
  projectId: string;
  datasetId: string;
  jobId: string;
  jobType: "auto_label";
  createdAt: number;
};

const ACTIVE_JOB_KEY = "axiomai:activeInferenceJob";

export function readActiveInferenceJob(): ActiveInferenceJob | null {
  try {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveInferenceJob;
    if (!parsed?.jobId || !parsed?.projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeActiveInferenceJob(job: ActiveInferenceJob) {
  try {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
  } catch {
    /* ignore */
  }
}

export function clearActiveInferenceJob() {
  try {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    /* ignore */
  }
}
