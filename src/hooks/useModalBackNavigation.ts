import { useEffect, useRef } from "react";

/**
 * Custom hook to handle back-button (popstate) navigation for closing modals.
 *
 * When `isOpen` becomes true:
 * 1. Pushes a dummy state into history (`window.history.pushState({ modalOpen: true }, "")`)
 * 2. Listens for `popstate` event. When triggered (user clicks browser/device Back button),
 *    invokes `onClose()`.
 * 3. On modal close or unmount (e.g. via 'X' button or backdrop click), automatically reverts the history entry.
 */
export function useModalBackNavigation(
  isOpen: boolean,
  onClose?: () => void,
  modalId?: string
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const pushedStateRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      pushedStateRef.current = false;
      return;
    }

    // Push state when modal opens
    pushedStateRef.current = true;
    const stateId = modalId || `modal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    window.history.pushState({ modalOpen: true, stateId }, "");

    const handlePopState = (_event: PopStateEvent) => {
      // Back button was pressed by user
      pushedStateRef.current = false;
      if (onCloseRef.current) {
        onCloseRef.current();
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // If modal is unmounted or closed programmatically (e.g. by clicking 'X' or backdrop)
      // rather than via back button, step back in history to clean up the dummy entry.
      if (pushedStateRef.current) {
        pushedStateRef.current = false;
        try {
          window.history.back();
        } catch (e) {
          console.warn("Failed to revert history state on modal close", e);
        }
      }
    };
  }, [isOpen, modalId]);
}
