/**
 * Modal dialogs: a haiiro Window over the dither veil (`.modal-root > .veil + .window.modal`). No fade, no
 * blur, no animation. Also the confirmation that replaces `window.confirm`.
 *
 * @module
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { InkButton, cx, type WindowTone } from "./basics.tsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const FIELDS = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]';

let openCount = 0;

/** Props of {@link Dialog}. */
export interface DialogProps {
  /** The label notched into the frame, like a prompt: `vim: ~/events/new`, `confirm: ~/store/delete`. */
  label: ReactNode;
  /** The dialog's accessible name. Defaults to `label` when that is a string. */
  title?: string;
  /** Frame colour: love for a destructive confirm, gold when you are needed, pine otherwise. */
  tone?: Exclude<WindowTone, "off">;
  /** 896px instead of 520px, for two-column editors. */
  wide?: boolean;
  /** Called on Esc, a click on the veil and the close button. */
  onClose: () => void;
  /** Called on Enter, unless the focus is in a textarea, a button, a link or a list. */
  onSubmit?: () => void;
  /** The footer line. Defaults to an `esc close` hint and a close button. Pass `null` for none. */
  foot?: ReactNode | null;
  /** Where focus goes on open. Default: the first field, else the first button. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

/**
 * A modal dialog. Opens with no animation; focus moves inside (the first field by default), is trapped
 * there, and returns to the opener on close. Esc and a click on the veil close it. The page behind stops
 * scrolling; the dialog's content scrolls instead. Rendered into the `.fx` shell root so it keeps the
 * haiiro scope and sits above the bar.
 */
export function Dialog({
  label,
  title,
  tone = "pine",
  wide,
  onClose,
  onSubmit,
  foot,
  initialFocus,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setHost(document.querySelector(".fx") ?? document.body);
  }, []);

  useEffect(() => {
    if (!host) return;
    const opener = document.activeElement as HTMLElement | null;
    openCount++;
    document.body.style.overflow = "hidden";
    const box = ref.current;
    const target =
      initialFocus?.current ??
      box?.querySelector<HTMLElement>(FIELDS) ??
      box?.querySelector<HTMLElement>(".content button:not([disabled])") ??
      box;
    target?.focus();
    return () => {
      openCount--;
      if (openCount === 0) document.body.style.overflow = "";
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [host]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key === "Tab") {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key === "Enter" && onSubmit) {
      const t = e.target as HTMLElement;
      if (t.closest("textarea, button, a, select, [role=listbox], [contenteditable=true]")) return;
      e.preventDefault();
      onSubmit();
    }
  };

  if (!host) return null;
  const name = title ?? (typeof label === "string" ? label : undefined);
  const footer =
    foot === undefined ? (
      <>
        <span>
          <span className="kbd">esc</span> close
        </span>
        <span className="r">
          <InkButton tone="flat" onClick={() => closeRef.current()}>
            close
          </InkButton>
        </span>
      </>
    ) : (
      foot
    );
  return createPortal(
    <div className="modal-root" onKeyDown={onKeyDown}>
      <div className="veil" onClick={() => closeRef.current()} />
      <section
        ref={ref}
        className={cx("window modal", tone !== "pine" && tone, wide && "wide", className)}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
      >
        <span className="section-header">{label}</span>
        <div className="content">{children}</div>
        {footer != null && <div className="foot">{footer}</div>}
      </section>
    </div>,
    host,
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  /** The frame label, for example `confirm: ~/store/delete`. Default `confirm: ~/`. */
  label?: ReactNode;
  /** Accessible name, for example `delete store item`. */
  title?: string;
  /** A narrator sentence that says what is lost or what happens. */
  message: ReactNode;
  /** The action word, lowercase: `delete`, `buy`, `discard`. */
  confirmLabel: string;
  /** Default `cancel`. */
  cancelLabel?: string;
  /** love for destructive confirms (default), gold for actions that spend or start something. */
  tone?: "love" | "gold";
  /** Disables the buttons and shows `busyLabel` on the action. */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A confirmation in a Modal: a narrator line and two buttons, the action (love or gold) and a muted
 * cancel that gets the focus, so Enter on open is safe. Replaces `window.confirm`.
 */
export function ConfirmDialog({
  label = "confirm: ~/",
  title,
  message,
  confirmLabel,
  cancelLabel = "cancel",
  tone = "love",
  busy,
  busyLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      label={label}
      title={title ?? confirmLabel}
      tone={tone}
      onClose={onCancel}
      initialFocus={cancel}
      foot={
        <span>
          <span className="kbd">esc</span> {cancelLabel}
        </span>
      }
    >
      <p className="nar">{message}</p>
      <div className="btns">
        <InkButton tone={tone} busy={busy} busyLabel={busyLabel} onClick={onConfirm}>
          {confirmLabel}
        </InkButton>
        <InkButton ref={cancel} tone="muted" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </InkButton>
      </div>
    </Dialog>
  );
}

/** Options of a {@link useConfirm} question. */
export type ConfirmOptions = Omit<ConfirmDialogProps, "onConfirm" | "onCancel" | "busy" | "busyLabel">;

/**
 * An awaitable replacement for `window.confirm`.
 *
 * @example
 * const { confirm, dialog } = useConfirm();
 * // in a handler:
 * if (!(await confirm({ message: `Delete ${name}? It is gone for good.`, confirmLabel: "delete" }))) return;
 * // in the JSX:
 * {dialog}
 *
 * @returns `confirm(options)`, which shows the dialog and resolves true (confirmed) or false, and the
 *   `dialog` element to render somewhere in the component.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...options, resolve })),
    [],
  );
  const dialog = ask ? (
    <ConfirmDialog
      {...ask}
      onConfirm={() => {
        ask.resolve(true);
        setAsk(null);
      }}
      onCancel={() => {
        ask.resolve(false);
        setAsk(null);
      }}
    />
  ) : null;
  return { confirm, dialog };
}
