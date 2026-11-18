"use client";

import { TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, IconButton, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "./cn";
import { uiStrings, type UiLocale } from "./locale";

const DIALOG_WIDTH = { sm: "24rem", md: "32rem", lg: "44rem", xl: "56rem" } as const;
const DRAWER_WIDTH = { sm: "24rem", md: "30rem", lg: "40rem", xl: "52rem" } as const;

interface ModalBaseProps {
  /** Whether it is showing. The component opens and closes the native dialog to match. */
  open: boolean;
  /** Called when the person closes it (Esc, the close button, the backdrop). Set `open` to false here. */
  onClose?: () => void;
  /** For URL-driven dialogs rendered by a server page: navigate here on close instead of calling onClose. */
  closeHref?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons at the bottom, in reading order (cancel first, primary last). */
  footer?: ReactNode;
  size?: keyof typeof DIALOG_WIDTH;
  /** false = cannot be dismissed with Esc or the backdrop, and has no close button. Use only while an action is mid-flight. */
  dismissible?: boolean;
  locale?: UiLocale;
  className?: string;
  children?: ReactNode;
}

export type DialogProps = ModalBaseProps;

export interface DrawerProps extends ModalBaseProps {
  /** Edge the pane slides from. Default right. */
  side?: "right" | "left";
}

function useNativeDialog(open: boolean, onClose: (() => void) | undefined, closeHref: string | undefined, dismissible: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const requestClose = useCallback(() => {
    if (closeHref) router.replace(closeHref, { scroll: false });
    onClose?.();
  }, [closeHref, onClose, router]);

  const pressedBackdrop = useRef(false);
  const handlers = {
    // Fired by Esc and by form[method=dialog]; keep React state in step with the element.
    onClose: () => {
      if (open) requestClose();
    },
    onCancel: (event: { preventDefault: () => void }) => {
      if (!dismissible) event.preventDefault();
    },
    // The dialog element itself is only hit on the backdrop. Require press AND release there, so dragging
    // a text selection out of the panel does not close it.
    onMouseDown: (event: MouseEvent<HTMLDialogElement>) => {
      pressedBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (dismissible && pressedBackdrop.current && event.target === event.currentTarget) requestClose();
      pressedBackdrop.current = false;
    },
  };
  return { ref, requestClose, handlers };
}

function ModalFrame({
  kind,
  side,
  open,
  onClose,
  closeHref,
  title,
  description,
  footer,
  size = "md",
  dismissible = true,
  locale = "en",
  className,
  children,
}: ModalBaseProps & { kind: "dialog" | "drawer"; side?: "right" | "left" }) {
  const { ref, requestClose, handlers } = useNativeDialog(open, onClose, closeHref, dismissible);
  const titleId = useId();
  const descriptionId = useId();
  const t = uiStrings(locale);
  const width = (kind === "drawer" ? DRAWER_WIDTH : DIALOG_WIDTH)[size];
  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-side={kind === "drawer" ? (side ?? "right") : undefined}
      style={{ "--ui-dialog-width": width } as CSSProperties}
      className={cn("ui-dialog", kind === "drawer" && "ui-drawer", className)}
      {...handlers}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {dismissible ? <IconButton label={t.close} icon={<X />} size="sm" className="-mr-2 -mt-1" onClick={requestClose} /> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer ? <footer className="flex flex-col-reverse gap-3 border-t border-line bg-canvas px-5 py-4 *:w-full sm:flex-row sm:justify-end sm:px-6 sm:*:w-auto">{footer}</footer> : null}
    </dialog>
  );
}

/**
 * Modal dialog on the native `<dialog>` element: focus is trapped and returned by the browser, Esc closes,
 * the page behind is inert. Use for a short, self-contained task; never stack dialogs.
 */
export function Dialog(props: DialogProps) {
  return <ModalFrame {...props} kind="dialog" />;
}

/** `Modal` is the same component as `Dialog`, under the other name people look for. */
export const Modal = Dialog;

/**
 * Side pane for the detail of one record while the list stays in view behind it.
 * Same behaviour as Dialog. URL-driven use: `<Drawer open closeHref="/sgo/verifications" …>`.
 */
export function Drawer({ side, ...props }: DrawerProps) {
  return <ModalFrame {...props} kind="drawer" side={side} />;
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Runs when the person confirms. If it returns a promise the dialog shows progress and closes when it settles. */
  onConfirm: () => void | Promise<void>;
  /** A question naming the thing: "Cancel this verification?" */
  title: ReactNode;
  /** What will happen, and whether it can be undone. */
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  /** `danger` for destructive or irreversible actions. */
  tone?: "default" | "danger";
  locale?: UiLocale;
  children?: ReactNode;
}

/** A yes/no question before a consequential action. The confirm button repeats the verb ("Revoke key"), never just "OK". */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, tone = "default", locale = "en", children }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const t = uiStrings(locale);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      size="sm"
      locale={locale}
      title={
        <span className="flex items-center gap-2">
          {tone === "danger" ? <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-danger-600" /> : null}
          {title}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t.cancel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      {children}
    </Dialog>
  );
}

/** Open/close state for a Dialog, Drawer or ConfirmDialog owned by a client component. */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return {
    open,
    onOpen: useCallback(() => setOpen(true), []),
    onClose: useCallback(() => setOpen(false), []),
    toggle: useCallback(() => setOpen((value) => !value), []),
  };
}

interface TriggerProps {
  /** The trigger button's text. */
  label: ReactNode;
  variant?: ButtonVariant;
  buttonSize?: ButtonSize;
  leadingIcon?: ReactNode;
  disabled?: boolean;
  triggerClassName?: string;
}

export interface DialogButtonProps extends TriggerProps, Omit<ModalBaseProps, "open" | "onClose" | "closeHref"> {
  /** Show as a side Drawer instead of a centred Dialog. */
  as?: "dialog" | "drawer";
  /** Close as soon as a form inside is submitted. Leave off for forms that can come back with validation errors. */
  closeOnSubmit?: boolean;
}

/**
 * A button that opens a dialog — usable straight from a server page, with server-rendered children
 * (for example a `<form action={serverAction}>`). No client code needed in the page.
 */
export function DialogButton({ label, variant = "secondary", buttonSize = "md", leadingIcon, disabled, triggerClassName, as = "dialog", closeOnSubmit, children, ...modal }: DialogButtonProps) {
  const { open, onOpen, onClose } = useDisclosure();
  return (
    <>
      <Button variant={variant} size={buttonSize} leadingIcon={leadingIcon} disabled={disabled} className={triggerClassName} onClick={onOpen} aria-haspopup="dialog">
        {label}
      </Button>
      <ModalFrame {...modal} kind={as} open={open} onClose={onClose}>
        <div onSubmit={closeOnSubmit ? onClose : undefined}>{children}</div>
      </ModalFrame>
    </>
  );
}

function ConfirmSubmit({ tone, children }: { tone: "default" | "danger"; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} loading={pending}>
      {children}
    </Button>
  );
}

export interface ConfirmButtonProps extends TriggerProps {
  /** The server action to run on confirm. It receives the hidden `fields` as FormData. */
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden fields sent with the action (ids). Never put secrets here. */
  fields?: Record<string, string>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  tone?: "default" | "danger";
  locale?: UiLocale;
}

/**
 * Button → confirmation → server action, in one component a server page can render:
 * `<ConfirmButton label="Revoke" tone="danger" title="Revoke this key?" confirmLabel="Revoke key" action={revokeKey} fields={{ id }} />`
 */
export function ConfirmButton({ label, variant = "secondary", buttonSize = "md", leadingIcon, disabled, triggerClassName, action, fields, title, description, confirmLabel, cancelLabel, tone = "default", locale = "en" }: ConfirmButtonProps) {
  const { open, onOpen, onClose } = useDisclosure();
  const formId = useId();
  const t = uiStrings(locale);
  return (
    <>
      <Button variant={variant} size={buttonSize} leadingIcon={leadingIcon} disabled={disabled} className={triggerClassName} onClick={onOpen} aria-haspopup="dialog">
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={onClose}
        size="sm"
        locale={locale}
        title={
          <span className="flex items-center gap-2">
            {tone === "danger" ? <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-danger-600" /> : null}
            {title}
          </span>
        }
      >
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
        <form
          id={formId}
          action={async (formData) => {
            await action(formData);
            onClose();
          }}
          className="mt-5 flex flex-col-reverse gap-3 *:w-full sm:flex-row sm:justify-end sm:*:w-auto"
        >
          {fields ? Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />) : null}
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel ?? t.cancel}
          </Button>
          <ConfirmSubmit tone={tone}>{confirmLabel}</ConfirmSubmit>
        </form>
      </Dialog>
    </>
  );
}
