"use server";

import * as classService from "@/lib/services/classService";
import { parseClassNamesInput } from "@/lib/classes/constants";
import { revalidateProject } from "@/lib/actions/revalidate";
import { CLASS_COLORS } from "@/lib/utils";

import type { ActionResult } from "@/lib/actions/types";

export async function createClass(
  projectId: string,
  formData: FormData
): Promise<ActionResult> {
  try {
    const name = (formData.get("name") as string)?.trim();
    const description = (formData.get("description") as string)?.trim() || null;
    const color = (formData.get("color") as string) || CLASS_COLORS[0];

    if (!name) return { error: "Class name is required" };

    const count = await classService.getClassCount(projectId);
    await classService.createClass(projectId, {
      name,
      description,
      color,
      sortOrder: count,
    });

    await revalidateProject(projectId);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create class" };
  }
}

export async function createClassesBulk(
  projectId: string,
  formData: FormData
): Promise<ActionResult> {
  try {
    const raw = (formData.get("names") as string) ?? "";
    const names = parseClassNamesInput(raw);

    if (names.length === 0) {
      return {
        error:
          "Enter at least one class name (one per line, comma-separated, or JSON array)",
      };
    }

    const startOrder = await classService.getClassCount(projectId);
    const rows = names.map((name, i) => ({
      name,
      color: CLASS_COLORS[(startOrder + i) % CLASS_COLORS.length],
      sortOrder: startOrder + i,
    }));

    await classService.createClassesBulk(projectId, rows);
    await revalidateProject(projectId);
    return { success: true, count: names.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to import classes" };
  }
}

export async function updateClass(
  projectId: string,
  classId: string,
  formData: FormData
): Promise<ActionResult> {
  try {
    const name = (formData.get("name") as string)?.trim();
    const description = (formData.get("description") as string)?.trim() || null;
    const color = formData.get("color") as string;

    if (!name) return { error: "Class name is required" };

    await classService.updateClass(projectId, classId, { name, description, color });
    await revalidateProject(projectId);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update class" };
  }
}

export async function deleteClass(
  projectId: string,
  classId: string
): Promise<ActionResult> {
  try {
    await classService.deleteClass(projectId, classId);
    await revalidateProject(projectId);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete class" };
  }
}

export async function deleteClasses(
  projectId: string,
  classIds: string[]
): Promise<ActionResult> {
  try {
    if (classIds.length === 0) return { error: "No classes selected" };
    await classService.deleteClasses(projectId, classIds);
    await revalidateProject(projectId);
    return { success: true, count: classIds.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete classes" };
  }
}

export async function deleteAllClasses(projectId: string): Promise<ActionResult> {
  try {
    await classService.deleteAllClasses(projectId);
    await revalidateProject(projectId);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete classes" };
  }
}
