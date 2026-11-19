"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Alert, Field, FileDropzone, RadioGroup, Select, type DropzoneFile, type FileRejection, type RadioOption } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { UPLOAD_KIND_CHOICES, type UploadKindChoice } from "../form-data";
import { UPLOAD_PATH } from "../policy";
import type { FlowFormFields } from "./hidden-fields";
import { readUploadOutcome, type UploadOutcome } from "./upload-result";

export interface UploadPanelProps {
  fields: FlowFormFields;
  members: Array<{ id: string; name: string }>;
  /** `<input accept>` value (from the storage service). */
  accept: string;
  maxSizeBytes: number;
  /** Most documents one verification may hold (the documents service's limit). */
  maxFiles: number;
  incomeYear: number;
}

interface Row extends DropzoneFile {
  file: File;
  kind: UploadKindChoice;
  memberId: string;
}

/** POSTs one file to the upload route with progress. Resolves with the parsed JSON body (or a network failure). */
function send(file: File, kind: UploadKindChoice, memberId: string, fields: FlowFormFields, onProgress: (fraction: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const body = new FormData();
    body.set("base", fields.base);
    body.set("v", fields.v);
    body.set("lang", fields.lang);
    body.set("kind", kind);
    if (memberId) body.set("memberId", memberId);
    body.set("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${UPLOAD_PATH}?lang=${fields.lang}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response as unknown });
    xhr.onerror = () => resolve({ status: 0, body: null });
    xhr.onabort = () => resolve({ status: 0, body: null });
    xhr.send(body);
  });
}

/**
 * Pick what a document is, then add files (drag, choose, or take a photo on a phone). Each file is uploaded on its
 * own with its progress and a plain-language error. The list of documents the server holds (with their status) is
 * rendered by the page and refreshed after each upload.
 */
export function UploadPanel({ fields, members, accept, maxSizeBytes, maxFiles, incomeYear }: UploadPanelProps) {
  const t = getDictionary(fields.lang);
  const u = t.upload;
  const router = useRouter();
  const [kind, setKind] = useState<UploadKindChoice | "">("");
  const [memberId, setMemberId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const counter = useRef(0);

  const update = useCallback((id: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);

  const upload = useCallback(
    async (row: Row) => {
      update(row.id, { status: "uploading", progress: 0, error: undefined });
      const outcome = await send(row.file, row.kind, row.memberId, fields, (fraction) => update(row.id, { progress: fraction }));
      const verdict = readUploadOutcome(outcome, fields.lang);
      if (verdict.kind === "error") {
        update(row.id, { status: "error", error: verdict.message, progress: undefined });
        return;
      }
      update(row.id, { status: "done", progress: undefined, detail: verdict.kind === "duplicate" ? verdict.message : row.detail });
      router.refresh();
    },
    [fields, router, update],
  );

  const onFilesAdded = (files: File[]) => {
    setNotice(null);
    if (!kind) {
      setNotice(t.errors.files.chooseKind);
      return;
    }
    const added: Row[] = files.map((file) => {
      counter.current += 1;
      return { id: `upload-${counter.current}`, name: file.name, sizeBytes: file.size, status: "queued", file, kind, memberId, detail: u.kinds[kind].label };
    });
    setRows((list) => [...list, ...added]);
    for (const row of added) void upload(row);
  };

  const onFilesRejected = (rejections: Array<FileRejection<File>>) => {
    const reasons = new Set(rejections.map((r) => r.reason));
    const messages = [...reasons].map((reason) => (reason === "too_large" ? t.errors.files.tooLarge : reason === "empty" ? t.errors.files.empty : reason === "too_many" ? t.errors.files.tooMany : t.errors.files.type));
    setNotice(`${rejections.map((r) => r.file.name).join(", ")}: ${messages.join(" ")}`);
  };

  const kindOptions: RadioOption[] = UPLOAD_KIND_CHOICES.map((k) => {
    const hint = u.kinds[k].hint;
    return { value: k, label: u.kinds[k].label, description: typeof hint === "function" ? hint(incomeYear) : hint };
  });

  return (
    <div className="space-y-6">
      <Field label={u.kindLegend} as="group" id="declaredKind" locale={fields.lang}>
        <RadioGroup name="declaredKind" options={kindOptions} value={kind} onChange={(v) => setKind(v as UploadKindChoice)} />
      </Field>
      {members.length > 0 ? (
        <Field label={u.memberLabel} hint={u.memberHint} optional id="memberId" locale={fields.lang}>
          <Select name="memberId" value={memberId} onChange={(event) => setMemberId(event.target.value)}>
            <option value="">{u.memberAny}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {!kind ? <p className="text-sm text-fg-muted">{t.errors.files.chooseKind}</p> : null}
      <div aria-live="polite">
        {notice ? (
          <Alert tone="warning" role="alert">
            {notice}
          </Alert>
        ) : null}
      </div>
      <FileDropzone
        files={rows}
        onFilesAdded={onFilesAdded}
        onFilesRejected={onFilesRejected}
        onRetry={(id) => {
          const row = rows.find((r) => r.id === id);
          if (row) void upload(row);
        }}
        onRemove={(id) => setRows((list) => list.filter((r) => r.id !== id || r.status === "uploading"))}
        accept={accept}
        maxSizeBytes={maxSizeBytes}
        maxFiles={maxFiles}
        capture
        hint={u.dropHint}
        locale={fields.lang}
        labels={{ filesHeading: u.uploading }}
        disabled={!kind}
      />
    </div>
  );
}
