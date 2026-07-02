"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Short polish delay so the transition never feels like a flash. */
const MIN_VISIBLE_MS = 420;
/** Fade-out duration — keep in sync with CSS. */
const EXIT_MS = 300;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - Math.min(1, t), 3);
}

interface NavigationContextValue {
  isTransitioning: boolean;
  isExiting: boolean;
  pendingKey: string | null;
  targetHref: string | null;
  progress: number;
  startNavigation: (href: string) => void;
  isPending: (key: string) => boolean;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

function isInternalNavClick(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }

  const target = event.target as HTMLElement | null;
  if (!target) return null;
  if (target.closest("[data-no-progress]")) return null;

  const anchor = target.closest("a");
  const href = anchor?.getAttribute("href");
  if (
    !anchor ||
    !href ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    anchor.target === "_blank"
  ) {
    return null;
  }

  return href;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [targetHref, setTargetHref] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const navigatingRef = useRef(false);
  const routeReadyRef = useRef(false);
  const readyAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runProgressLoop = useCallback(() => {
    const tick = () => {
      if (!navigatingRef.current) return;

      const elapsed = Date.now() - startedAtRef.current;
      let value: number;

      if (routeReadyRef.current) {
        const sinceReady = Date.now() - readyAtRef.current;
        value = Math.min(100, 86 + easeOutCubic(sinceReady / 320) * 14);
      } else {
        value = 6 + easeOutCubic(elapsed / 1200) * 80;
      }

      setProgress(value);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const finishTransition = useCallback(() => {
    if (!navigatingRef.current) return;

    clearTimers();
    setProgress(100);
    setIsExiting(true);

    exitTimerRef.current = setTimeout(() => {
      navigatingRef.current = false;
      routeReadyRef.current = false;
      setIsTransitioning(false);
      setIsExiting(false);
      setPendingKey(null);
      setTargetHref(null);
      setProgress(0);
    }, EXIT_MS);
  }, [clearTimers]);

  const scheduleFinish = useCallback(() => {
    if (!navigatingRef.current) return;

    routeReadyRef.current = true;
    readyAtRef.current = Date.now();

    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
    }

    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

    finishTimerRef.current = setTimeout(finishTransition, remaining);
  }, [finishTransition]);

  const beginTransition = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.origin);
      const next = `${url.pathname}${url.search}`;
      const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
      if (next === current) return;

      clearTimers();

      navigatingRef.current = true;
      routeReadyRef.current = false;
      startedAtRef.current = Date.now();
      setPendingKey(href);
      setTargetHref(href);
      setIsExiting(false);
      setIsTransitioning(true);
      setProgress(6);

      runProgressLoop();
    },
    [pathname, searchParams, clearTimers, runProgressLoop]
  );

  const startNavigation = useCallback(
    (href: string) => beginTransition(href),
    [beginTransition]
  );

  const isPending = useCallback(
    (key: string) => pendingKey === key,
    [pendingKey]
  );

  useEffect(() => {
    if (!navigatingRef.current) return;
    scheduleFinish();
    return () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }
    };
  }, [pathname, searchParams, scheduleFinish]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const href = isInternalNavClick(event);
      if (!href) return;

      const url = new URL(href, window.location.origin);
      const next = `${url.pathname}${url.search}`;
      const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
      if (next === current) return;

      beginTransition(href);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchParams, beginTransition]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return (
    <NavigationContext.Provider
      value={{
        isTransitioning,
        isExiting,
        pendingKey,
        targetHref,
        progress,
        startNavigation,
        isPending,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return ctx;
}
