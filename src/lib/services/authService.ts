import {
  getAdminAuth,
  getAdminDb,
  nowIso,
} from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/paths";
import type { FirestoreUser, UserRole } from "@/lib/types/firestore";
import { cookies } from "next/headers";

const SESSION_COOKIE = "__session";
const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 5 * 1000; // 5 days

export async function setSessionCookie(idToken: string) {
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  const expiresIn = SESSION_MAX_AGE_MS;
  const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
    expiresIn,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: expiresIn / 1000,
    path: "/",
  });

  return { uid: decoded.uid };
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<{
  uid: string;
  email?: string;
  role: UserRole;
} | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    const profile = await getUserProfile(decoded.uid);
    return {
      uid: decoded.uid,
      email: decoded.email,
      role: profile?.role ?? "annotator",
    };
  } catch {
    return null;
  }
}

export async function createUserProfile(
  uid: string,
  data: { fullName: string; email: string; role?: UserRole }
) {
  const db = getAdminDb();
  const now = nowIso();
  const user: FirestoreUser = {
    uid,
    fullName: data.fullName,
    email: data.email,
    role: data.role ?? "annotator",
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(COLLECTIONS.users).doc(uid).set(user, { merge: true });
  return user;
}

export async function getUserProfile(uid: string): Promise<FirestoreUser | null> {
  const snap = await getAdminDb().collection(COLLECTIONS.users).doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as FirestoreUser;
}

export async function requireSessionUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("Authentication required");
  return user;
}

export async function isAdmin(uid: string): Promise<boolean> {
  const profile = await getUserProfile(uid);
  return profile?.role === "admin";
}
