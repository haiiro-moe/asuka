import type { ReactNode } from "react";
import { Dialog, type DialogProps } from "./ui/Dialog.tsx";

/** Props of {@link Modal}. */
export interface ModalProps {
  /** The dialog's name. Shown in the frame label unless `label` is given; keep it lowercase. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Widens the dialog (896px) for editors that need two columns. */
  wide?: boolean;
  /** The frame label, written like a prompt: `vim: ~/events/new`. Defaults to `title`. */
  label?: ReactNode;
  /** Frame colour; see {@link Dialog}. */
  tone?: DialogProps["tone"];
  /** Footer line; see {@link Dialog}. */
  foot?: ReactNode | null;
  /** Called on Enter outside textareas and buttons; see {@link Dialog}. */
  onSubmit?: () => void;
}

/**
 * The dashboard's modal: a haiiro Window over the dither veil (see {@link Dialog} for focus, keys and
 * scrolling). Esc, the close button and a click on the veil close it. Kept under this name and with its
 * original props so pages written before the redesign keep working.
 */
export function Modal({ title, onClose, children, wide = false, label, tone, foot, onSubmit }: ModalProps) {
  return (
    <Dialog label={label ?? title} title={title} onClose={onClose} wide={wide} tone={tone} foot={foot} onSubmit={onSubmit}>
      {children}
    </Dialog>
  );
}
