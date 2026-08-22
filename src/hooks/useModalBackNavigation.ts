import { useEffect, useRef, useId } from "react";

interface ModalEntry {
  id: string;
  onClose: () => void;
  closedByPopstate: boolean;
}

class ModalHistoryManager {
  private static instance: ModalHistoryManager | null = null;
  private stack: ModalEntry[] = [];
  private programmaticPopsPending = 0;
  private isListenerAttached = false;
  private reconcileScheduled = false;

  private constructor() {
    this.initBaseState();
    this.attachGlobalListener();
  }

  public static getInstance(): ModalHistoryManager {
    if (!ModalHistoryManager.instance) {
      ModalHistoryManager.instance = new ModalHistoryManager();
    }
    return ModalHistoryManager.instance;
  }

  private getBrowserDepth(): number {
    if (typeof window === "undefined") return 0;
    const depth = window.history.state?.__modalDepth;
    return typeof depth === "number" && !isNaN(depth) ? depth : 0;
  }

  private initBaseState() {
    if (typeof window === "undefined") return;
    try {
      const current = window.history.state;
      // If no depth is set, or if depth was set by a previous session/reload with no open modals, reset to 0
      if (!current || typeof current.__modalDepth !== "number" || current.__modalDepth > 0) {
        window.history.replaceState({ ...current, __modalDepth: 0 }, "");
      }
    } catch (e) {
      console.warn("[ModalHistoryManager] Failed to init base state:", e);
    }
  }

  private attachGlobalListener() {
    if (typeof window === "undefined" || this.isListenerAttached) return;
    this.isListenerAttached = true;

    window.addEventListener("popstate", (_event: PopStateEvent) => {
      // 1. If this popstate was triggered by programmatic history.back() during UI-driven close, ignore it
      if (this.programmaticPopsPending > 0) {
        this.programmaticPopsPending--;
        return;
      }

      // 2. Real user hardware / browser Back button pressed
      if (this.stack.length > 0) {
        // Pop top modal from the stack
        const topModal = this.stack.pop();
        if (topModal) {
          topModal.closedByPopstate = true;
          try {
            topModal.onClose();
          } catch (e) {
            console.error("[ModalHistoryManager] Error in onClose handler:", e);
          }
        }
      }
    });
  }

  public register(id: string, onClose: () => void) {
    // If already registered, update the onClose callback reference
    const existing = this.stack.find((m) => m.id === id);
    if (existing) {
      existing.onClose = onClose;
      return;
    }

    // Add to stack
    this.stack.push({
      id,
      onClose,
      closedByPopstate: false,
    });

    this.scheduleReconciliation();
  }

  public unregister(id: string) {
    const index = this.stack.findIndex((m) => m.id === id);
    if (index === -1) return;

    const [modal] = this.stack.splice(index, 1);

    // If it was closed by popstate, browser history was already stepped back by the browser.
    // No need to call history.back().
    if (modal.closedByPopstate) {
      return;
    }

    // Modal was closed via UI action (e.g. 'X' button, backdrop, Done/Cancel button)
    this.scheduleReconciliation();
  }

  private scheduleReconciliation() {
    if (this.reconcileScheduled) return;
    this.reconcileScheduled = true;

    // Use microtask queue so that when one modal closes and another opens in the same render batch,
    // they resolve together without unnecessary back/push history churn.
    queueMicrotask(() => {
      this.reconcileScheduled = false;
      this.reconcile();
    });
  }

  private reconcile() {
    if (typeof window === "undefined") return;

    const targetDepth = this.stack.length;
    const currentDepth = this.getBrowserDepth();

    if (currentDepth < targetDepth) {
      // Need to push states until currentDepth matches targetDepth
      const countToPush = targetDepth - currentDepth;
      for (let i = 0; i < countToPush; i++) {
        const nextDepth = currentDepth + i + 1;
        const matchingModal = this.stack[nextDepth - 1];
        try {
          window.history.pushState(
            {
              __modalDepth: nextDepth,
              __modalId: matchingModal ? matchingModal.id : `modal-${nextDepth}`,
            },
            ""
          );
        } catch (e) {
          console.warn("[ModalHistoryManager] pushState failed:", e);
        }
      }
    } else if (currentDepth > targetDepth) {
      // Need to pop states until currentDepth matches targetDepth
      const countToPop = currentDepth - targetDepth;
      for (let i = 0; i < countToPop; i++) {
        // SAFETY GUARD: Never pop if current depth is already 0 (prevents navigating out of app)
        if (this.getBrowserDepth() <= 0) break;

        this.programmaticPopsPending++;
        try {
          window.history.back();
        } catch (e) {
          this.programmaticPopsPending = Math.max(0, this.programmaticPopsPending - 1);
          console.warn("[ModalHistoryManager] history.back failed:", e);
        }
      }
    }
  }
}

/**
 * Custom hook to handle back-button navigation for modals, dialogs, drawers, and overlay popups.
 * 
 * @param isOpen Whether the modal is currently open and active
 * @param onClose Callback to close the modal when user presses hardware/browser Back button
 * @param customId Optional unique string identifier for the modal
 */
export function useModalBackNavigation(
  isOpen: boolean,
  onClose?: () => void,
  customId?: string
) {
  const autoId = useId();
  const modalId = customId || autoId;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !onCloseRef.current) {
      return;
    }

    const manager = ModalHistoryManager.getInstance();
    
    // Stable wrapper that always invokes the latest onClose callback
    const handleClose = () => {
      if (onCloseRef.current) {
        onCloseRef.current();
      }
    };

    manager.register(modalId, handleClose);

    return () => {
      manager.unregister(modalId);
    };
  }, [isOpen, modalId]);
}
