import { useEffect, useRef, useId } from "react";

interface ModalStackEntry {
  id: string;
  onClose: () => void;
}

// Global modal stack tracking all currently open modals
const modalStack: ModalStackEntry[] = [];

// Flag to indicate if a popstate event was triggered by programmatic history.back()
let isProgrammaticPop = false;

// Global popstate handler initialized once
let isGlobalListenerAttached = false;

function ensureGlobalPopStateListener() {
  if (isGlobalListenerAttached) return;
  isGlobalListenerAttached = true;

  window.addEventListener("popstate", (_event) => {
    // If popstate was triggered by our own programmatic history.back() when user clicked an 'X' button, ignore it
    if (isProgrammaticPop) {
      isProgrammaticPop = false;
      return;
    }

    // User pressed browser / device back button
    if (modalStack.length > 0) {
      const topModal = modalStack.pop();
      if (topModal && topModal.onClose) {
        try {
          topModal.onClose();
        } catch (e) {
          console.error("Error executing modal onClose handler:", e);
        }
      }
    }
  });
}

/**
 * Custom hook to handle device / browser back-button (popstate) navigation for closing modal dialogs.
 * 
 * - When `isOpen` is true: Pushes a history entry and adds the modal to the active stack.
 * - When user presses Back button: Closes the top-most modal on the stack without leaving the page.
 * - When user clicks 'X', backdrop, or closes modal via UI: Reverts the history entry cleanly.
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
    ensureGlobalPopStateListener();

    if (!isOpen || !onCloseRef.current) {
      return;
    }

    // Check if this modal is already on top of the stack
    const existingIndex = modalStack.findIndex((item) => item.id === modalId);
    if (existingIndex >= 0) {
      modalStack[existingIndex].onClose = () => {
        if (onCloseRef.current) onCloseRef.current();
      };
      return;
    }

    // Push a new history entry for this modal
    try {
      window.history.pushState({ modalOpenId: modalId }, "");
    } catch (e) {
      console.warn("Failed to push history state for modal:", e);
    }

    // Add to modal stack
    modalStack.push({
      id: modalId,
      onClose: () => {
        if (onCloseRef.current) onCloseRef.current();
      }
    });

    return () => {
      // Cleanup when modal closes or unmounts
      const index = modalStack.findIndex((item) => item.id === modalId);
      if (index >= 0) {
        // Modal is still in stack, meaning it was closed via UI (e.g. 'X' button or backdrop), NOT via popstate
        modalStack.splice(index, 1);
        try {
          isProgrammaticPop = true;
          window.history.back();
        } catch (e) {
          isProgrammaticPop = false;
          console.warn("Failed to step back history on modal close:", e);
        }
      }
    };
  }, [isOpen, modalId]);
}
