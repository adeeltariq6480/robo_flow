"use client";

import { useNavigation } from "@/contexts/navigation-context";

/** Tracks in-flight navigation with a minimum transition animation duration. */
export function useNavigationPending() {
  const { startNavigation, isPending, pendingKey } = useNavigation();
  return { pendingKey, startNavigation, isPending };
}
