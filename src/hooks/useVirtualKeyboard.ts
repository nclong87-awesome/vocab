import { useState, useEffect, useRef, useCallback } from "react";

interface UseVirtualKeyboardOptions {
  inputRef?: React.RefObject<HTMLElement | null>;
  /** Minimum height reduction in pixels to be considered a virtual keyboard (default: 130) */
  minKeyboardHeight?: number;
}

/**
 * Hook to detect whether the on-screen virtual keyboard is currently open.
 * Specifically designed for mobile browsers (Android Chrome, iOS Safari, mobile WebViews).
 * When virtual keyboard is closed or on physical keyboards (desktop), returns false.
 */
export function useVirtualKeyboard(options: UseVirtualKeyboardOptions = {}): boolean {
  const { inputRef, minKeyboardHeight = 130 } = options;
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // Baseline height of viewport when no input is focused
  const unFocusedHeightRef = useRef<number>(
    typeof window !== "undefined"
      ? Math.max(window.innerHeight, window.visualViewport?.height || 0)
      : 0
  );
  const lastWidthRef = useRef<number>(
    typeof window !== "undefined" ? window.innerWidth : 0
  );

  const isTargetFocused = useCallback((): boolean => {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    if (!active) return false;

    if (inputRef && inputRef.current) {
      return active === inputRef.current || inputRef.current.contains(active);
    }

    const tag = active.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || (active as HTMLElement).isContentEditable;
  }, [inputRef]);

  const evaluateKeyboardState = useCallback((): boolean => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return false;
    }

    // 1. If target input is NOT focused, virtual keyboard cannot be open for it
    if (!isTargetFocused()) {
      // While unfocused, continuously update the baseline unfocused height
      const currentHeight = Math.max(window.innerHeight, window.visualViewport?.height || 0);
      if (currentHeight > unFocusedHeightRef.current) {
        unFocusedHeightRef.current = currentHeight;
      }
      return false;
    }

    // 2. Check VirtualKeyboard API if supported (modern Chromium on Android)
    if ("virtualKeyboard" in navigator) {
      const vk = (navigator as any).virtualKeyboard;
      if (vk && typeof vk.boundingRect?.height === "number" && vk.boundingRect.height > 50) {
        return true;
      }
    }

    const vv = window.visualViewport;
    const currentVvHeight = vv ? vv.height : window.innerHeight;
    const currentInnerHeight = window.innerHeight;

    // 3. iOS Safari check: innerHeight remains constant, visualViewport shrinks
    if (currentInnerHeight - currentVvHeight > minKeyboardHeight) {
      return true;
    }

    // 4. Android Chrome / other mobile browsers:
    // Compare against baseline height when input was not focused
    const heightDelta = unFocusedHeightRef.current - currentVvHeight;
    if (heightDelta > minKeyboardHeight) {
      return true;
    }

    // 5. Screen height comparison fallback for mobile user agents
    // (e.g. if page loaded with input already focused)
    const isMobileUa =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (isMobileUa && window.screen && window.screen.height) {
      const screenDelta = window.screen.height - currentVvHeight;
      // Normal mobile browser chrome is typically < 160px. Virtual keyboard is >= 240px.
      if (screenDelta > 220) {
        return true;
      }
    }

    return false;
  }, [isTargetFocused, minKeyboardHeight]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timeoutIds: NodeJS.Timeout[] = [];

    const triggerCheck = () => {
      const open = evaluateKeyboardState();
      setIsKeyboardOpen(open);
    };

    const scheduleMultiCheck = () => {
      triggerCheck();
      // Clear previous pending timers
      timeoutIds.forEach(clearTimeout);
      timeoutIds = [];

      // Mobile keyboards take 100ms - 300ms to animate in/out
      timeoutIds.push(setTimeout(triggerCheck, 80));
      timeoutIds.push(setTimeout(triggerCheck, 180));
      timeoutIds.push(setTimeout(triggerCheck, 320));
      timeoutIds.push(setTimeout(triggerCheck, 500));
    };

    const handleResize = () => {
      // Check for orientation change or large window width change
      const currentWidth = window.innerWidth;
      if (Math.abs(currentWidth - lastWidthRef.current) > 60) {
        lastWidthRef.current = currentWidth;
        // Reset unfocused height baseline on orientation change
        unFocusedHeightRef.current = Math.max(window.innerHeight, window.visualViewport?.height || 0);
      }
      triggerCheck();
    };

    const handleFocusIn = () => {
      scheduleMultiCheck();
    };

    const handleFocusOut = () => {
      // When focus leaves, immediately close and check baseline
      scheduleMultiCheck();
    };

    // Attach listeners to visualViewport
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", handleResize);
      vv.addEventListener("scroll", handleResize);
    }

    // Attach window resize listener
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);

    // Direct element listeners on inputRef if provided
    const targetElement = inputRef?.current;
    if (targetElement) {
      targetElement.addEventListener("focus", handleFocusIn);
      targetElement.addEventListener("blur", handleFocusOut);
    }

    // VirtualKeyboard geometrychange listener if available
    let vk: any = null;
    let onGeometryChange: any = null;
    if ("virtualKeyboard" in navigator) {
      vk = (navigator as any).virtualKeyboard;
      if (vk && typeof vk.addEventListener === "function") {
        onGeometryChange = () => triggerCheck();
        try {
          vk.addEventListener("geometrychange", onGeometryChange);
        } catch {
          // Ignore if unsupported
        }
      }
    }

    // Initial check
    triggerCheck();

    return () => {
      timeoutIds.forEach(clearTimeout);
      if (vv) {
        vv.removeEventListener("resize", handleResize);
        vv.removeEventListener("scroll", handleResize);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);

      if (targetElement) {
        targetElement.removeEventListener("focus", handleFocusIn);
        targetElement.removeEventListener("blur", handleFocusOut);
      }

      if (vk && onGeometryChange) {
        try {
          vk.removeEventListener("geometrychange", onGeometryChange);
        } catch {
          // Ignore
        }
      }
    };
  }, [evaluateKeyboardState, inputRef]);

  return isKeyboardOpen;
}
