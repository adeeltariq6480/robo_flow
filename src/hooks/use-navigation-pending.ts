"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Tracks in-flight navigation; auto-clears when the route finishes loading. */
export function useNavigationPending() {
  const pathname = usePathname();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    setPendingKey(null);
  }, [pathname]);

  const startNavigation = useCallback((key: string) => {
    setPendingKey(key);
  }, []);

  const isPending = useCallback(
    (key: string) => pendingKey === key,
    [pendingKey]
  );

  return { pendingKey, startNavigation, isPending };
}
