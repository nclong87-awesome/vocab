import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

interface MobileSideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function MobileSideDrawer({
  isOpen,
  onClose,
  title,
  children
}: MobileSideDrawerProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50" id="mobile-drawer-overlay">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-stone-900/60"
          />
          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="absolute right-0 top-0 bottom-0 w-full sm:w-[580px] md:w-[720px] lg:w-[820px] xl:w-[900px] max-w-full bg-white shadow-2xl flex flex-col h-full overflow-hidden"
            id="mobile-drawer-body"
          >
            {/* Header */}
            <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-stone-900 text-white font-black text-xs">V</span>
                <span className="font-bold text-sm tracking-tight capitalize">
                  {title === "collection" ? "My Collection" : title}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-stone-500 hover:text-stone-950 hover:bg-stone-100 rounded transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Side Panel Body */}
            <div className="flex-1 overflow-hidden">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
