"use client";

import { useEffect, useRef } from "react";

const focusableSelector =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog shell: overlay, aria wiring, Esc-to-close and a Tab focus
 * trap. Rendered only while open, so its effects double as the open/close
 * lifecycle. The trap is written once and reused by every dialog.
 */
export function Modal({
  onClose,
  labelledBy,
  overlayClassName,
  panelClassName,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  overlayClassName?: string;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Keep the close callback fresh without re-running the trap effects
  // (re-running would steal focus back to the first element on every
  // parent re-render, e.g. while typing in the dialog).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // Focus the first focusable element on open.
    const firstFocusable =
      overlay.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    const handleTrapFocus = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusableElements =
        overlay.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusableElements.length === 0) return;

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("keydown", handleTrapFocus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleTrapFocus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={
        overlayClassName ??
        "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      }
    >
      <div className={panelClassName}>{children}</div>
    </div>
  );
}
