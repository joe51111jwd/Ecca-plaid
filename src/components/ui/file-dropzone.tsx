"use client";

import { Camera, CircleAlert, CircleCheck, FileText, RotateCcw, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { buttonClasses, IconButton } from "./button";
import { cn } from "./cn";
import { formatBytes, partitionFiles, type FileRejection } from "./file-rules";
import { uiStrings, type UiLocale, type UiStrings } from "./locale";
import { ProgressBar } from "./progress-bar";
import { Spinner } from "./spinner";

export type DropzoneFileStatus = "queued" | "uploading" | "done" | "error";

/** One row of the file list. The caller owns this state and updates it as its upload progresses. */
export interface DropzoneFile {
  id: string;
  name: string;
  sizeBytes?: number;
  status: DropzoneFileStatus;
  /** 0…1 while uploading. Omit for an indeterminate upload. */
  progress?: number;
  /** Why it failed, in the person's language. Shown when status is "error". */
  error?: ReactNode;
  /** Extra text after the name: what kind of document it is ("Award letter"). */
  detail?: ReactNode;
}

type DropzoneLabels = Partial<
  Pick<
    UiStrings,
    "dropzoneTitle" | "dropzoneTitleTouch" | "dropzoneBrowse" | "dropzoneTakePhoto" | "dropzoneDropHere" | "fileQueued" | "fileUploading" | "fileDone" | "fileError" | "fileRemove" | "fileRetry" | "filesHeading"
  >
>;

export interface FileDropzoneProps {
  /** The files to list, with their status. Controlled by the caller. */
  files: DropzoneFile[];
  /** New files that passed the rules. Start uploading them and add rows to `files`. */
  onFilesAdded: (files: File[]) => void;
  /** Files refused by `accept`, `maxSizeBytes` or `maxFiles`, with the reason — show the person why. */
  onFilesRejected?: (rejections: Array<FileRejection<File>>) => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  /** HTML accept syntax: "application/pdf,image/*". */
  accept?: string;
  maxSizeBytes?: number;
  maxFiles?: number;
  multiple?: boolean;
  /** Offer "Take a photo" on touch devices (opens the rear camera). */
  capture?: boolean;
  disabled?: boolean;
  /** A line under the title: accepted types and size, in plain words. */
  hint?: ReactNode;
  locale?: UiLocale;
  labels?: DropzoneLabels;
  className?: string;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

/**
 * Add files by dragging, choosing, or — on a phone — taking a photo, and see each file's progress.
 * Presentational only: it never uploads. The caller uploads in `onFilesAdded` and feeds status back
 * through `files`.
 */
export function FileDropzone({ files, onFilesAdded, onFilesRejected, onRemove, onRetry, accept, maxSizeBytes, maxFiles, multiple = true, capture, disabled, hint, locale = "en", labels, className, id, ...aria }: FileDropzoneProps) {
  const generated = useId();
  const inputId = id ?? `fd${generated}`;
  const cameraId = `${inputId}-camera`;
  const t = uiStrings(locale, labels);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const invalid = aria["aria-invalid"] === true || aria["aria-invalid"] === "true";

  const add = (list: FileList | null) => {
    if (!list || list.length === 0 || disabled) return;
    const chosen = multiple ? Array.from(list) : Array.from(list).slice(0, 1);
    const { accepted, rejected } = partitionFiles(chosen, { accept, maxSizeBytes, remainingSlots: maxFiles === undefined ? undefined : maxFiles - files.length });
    if (accepted.length > 0) onFilesAdded(accepted);
    if (rejected.length > 0) onFilesRejected?.(rejected);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    add(event.dataTransfer.files);
  };

  return (
    <div className={className}>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (disabled) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors sm:py-8",
          dragging ? "border-action bg-brand-surface" : invalid ? "border-danger-600 bg-surface" : "border-line-control bg-surface",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span aria-hidden="true" className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-brand-surface text-brand-700">
          <Upload className="size-5" />
        </span>
        <p className="text-base font-semibold text-fg">
          {dragging ? t.dropzoneDropHere : <><span className="pointer-coarse:hidden">{t.dropzoneTitle}</span><span className="hidden pointer-coarse:inline">{t.dropzoneTitleTouch}</span></>}
        </p>
        {hint ? (
          <p id={`${inputId}-hint`} className="mt-1 text-sm text-fg-muted">
            {hint}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
          {/* The inputs stay in the tab order (visually hidden, not display:none); their labels show the focus ring. */}
          <label htmlFor={inputId} className={cn(buttonClasses({ variant: "secondary", size: "md" }), "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus", disabled && "pointer-events-none")}>
            <FileText aria-hidden="true" className="size-4" />
            {t.dropzoneBrowse}
            <input
              id={inputId}
              type="file"
              className="sr-only"
              accept={accept}
              multiple={multiple}
              disabled={disabled}
              aria-labelledby={aria["aria-labelledby"]}
              aria-describedby={[aria["aria-describedby"], hint ? `${inputId}-hint` : undefined].filter(Boolean).join(" ") || undefined}
              aria-invalid={invalid || undefined}
              onChange={(event) => {
                add(event.target.files);
                // Allow choosing the same file again after removing it.
                event.target.value = "";
              }}
            />
          </label>
          {capture ? (
            <label htmlFor={cameraId} className={cn(buttonClasses({ variant: "secondary", size: "md" }), "hidden pointer-coarse:inline-flex has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus", disabled && "pointer-events-none")}>
              <Camera aria-hidden="true" className="size-4" />
              {t.dropzoneTakePhoto}
              <input
                id={cameraId}
                type="file"
                className="sr-only"
                accept="image/*"
                capture="environment"
                disabled={disabled}
                onChange={(event) => {
                  add(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
      </div>

      {files.length > 0 ? (
        <ul aria-label={t.filesHeading} className="mt-3 divide-y divide-line rounded-card border border-line bg-surface">
          {files.map((file) => (
            <li key={file.id} className="flex items-start gap-3 px-3.5 py-3">
              <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 [&>svg]:size-5">
                {file.status === "done" ? <CircleCheck className="text-success-600" /> : file.status === "error" ? <CircleAlert className="text-danger-600" /> : file.status === "uploading" ? <Spinner size="md" className="text-brand-600" /> : <FileText className="text-fg-muted" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg" title={file.name}>
                  {file.name}
                </p>
                <p className={cn("text-sm", file.status === "error" ? "font-medium text-danger-fg" : "text-fg-muted")}>
                  {file.status === "error" ? (file.error ?? t.fileError) : file.status === "uploading" ? t.fileUploading : file.status === "done" ? t.fileDone : t.fileQueued}
                  {file.status !== "error" && file.sizeBytes !== undefined ? <span> · {formatBytes(file.sizeBytes)}</span> : null}
                  {file.status !== "error" && file.detail ? <span> · {file.detail}</span> : null}
                </p>
                {file.status === "uploading" && file.progress !== undefined ? <ProgressBar value={file.progress} label={`${t.fileUploading} ${file.name}`} size="sm" className="mt-2" /> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {file.status === "error" && onRetry ? <IconButton label={t.fileRetry(file.name)} icon={<RotateCcw />} size="sm" onClick={() => onRetry(file.id)} /> : null}
                {onRemove ? <IconButton label={t.fileRemove(file.name)} icon={<Trash2 />} size="sm" onClick={() => onRemove(file.id)} disabled={disabled} /> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
