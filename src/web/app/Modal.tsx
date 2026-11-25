import type { ReactNode } from "react";

/** Comic-styled modal dialog. Clicking the backdrop or ✕ closes it. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Widens the dialog for editors that need two columns. */
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className={`comic-panel w-full ${wide ? "max-w-4xl" : "max-w-lg"} max-h-[85vh] overflow-y-auto p-4 sm:p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="comic-title text-2xl sm:text-3xl min-w-0">{title}</h3>
          <button
            className="comic-btn comic-btn--ghost px-2.5 py-1 text-sm shrink-0"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
