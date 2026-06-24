"use server";

import {
  createUserProfile,
  setSessionCookie,
  clearSessionCookie,
} from "@/lib/services/authService";

export async function establishSession(idToken: string) {
  try {
    const { uid } = await setSessionCookie(idToken);
    return { success: true, uid };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Session failed" };
  }
}

export async function signOutSession() {
  await clearSessionCookie();
  return { success: true };
}

export async function registerUserProfile(data: {
  uid: string;
  fullName: string;
  email: string;
}) {
  try {
    await createUserProfile(data.uid, {
      fullName: data.fullName,
      email: data.email,
      role: "annotator",
    });
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Profile creation failed" };
  }
}
