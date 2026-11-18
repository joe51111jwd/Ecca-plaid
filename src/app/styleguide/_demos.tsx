"use client";

import { CircleCheck, FileText, Landmark, Upload } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DateInput,
  Dialog,
  Drawer,
  Field,
  Fieldset,
  FileDropzone,
  FormActions,
  FormError,
  Input,
  KeyValue,
  KeyValueList,
  Money,
  MoneyInput,
  OtpInput,
  RadioGroup,
  StatusBadge,
  SubmitButton,
  Textarea,
  fieldError,
  useDisclosure,
  useToast,
  type DropzoneFile,
  type FileDropzoneProps,
  type FileRejection,
} from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { demoApplyAction } from "./_actions";

/** Readout line under an interactive demo: what the component is emitting. */
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-3 text-sm text-fg-muted">
      {label}: <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.8125rem] text-fg">{value}</code>
    </p>
  );
}

export function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => toast({ title: "Link copied", tone: "neutral" })}>
        Neutral
      </Button>
      <Button variant="secondary" onClick={() => toast({ title: "Reminder sent", description: "Maria Alvarez will get an email with a new link.", tone: "success" })}>
        Success with detail
      </Button>
      <Button variant="secondary" onClick={() => toast({ title: "Could not send the reminder", description: "Try again in a moment.", tone: "danger" })}>
        Danger (announced at once)
      </Button>
    </div>
  );
}

export function DialogDemo() {
  const dialog = useDisclosure();
  const large = useDisclosure();
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={dialog.onOpen}>
        Open dialog
      </Button>
      <Button variant="secondary" onClick={large.onOpen}>
        Open large dialog
      </Button>
      <Dialog
        open={dialog.open}
        onClose={dialog.onClose}
        title="Ask the family for another document"
        description="They will get an email with a link back to their application."
        footer={
          <>
            <Button variant="secondary" onClick={dialog.onClose}>
              Cancel
            </Button>
            <Button onClick={dialog.onClose}>Send request</Button>
          </>
        }
      >
        <Field label="What do you need?" hint="The family sees this exactly as you write it.">
          <Textarea defaultValue="Please upload the second page of your SNAP award letter. The page with the dates is missing." />
        </Field>
      </Dialog>
      <Dialog open={large.open} onClose={large.onClose} size="lg" title="Evidence summary" description="What the decision was based on.">
        <KeyValueList>
          <KeyValue label="Decision">
            <StatusBadge kind="verification" status="eligible" provisional />
          </KeyValue>
          <KeyValue label="Method">Categorical — SNAP award letter</KeyValue>
          <KeyValue label="Income limit used">
            <Money cents={31_200_000} />
          </KeyValue>
          <KeyValue label="Award letter date">September 30, 2026</KeyValue>
          <KeyValue label="Reviewed by">Engine (no exceptions)</KeyValue>
        </KeyValueList>
      </Dialog>
    </div>
  );
}

export function DrawerDemo() {
  const drawer = useDisclosure();
  return (
    <>
      <Button variant="secondary" onClick={drawer.onOpen}>
        Open drawer
      </Button>
      <Drawer
        open={drawer.open}
        onClose={drawer.onClose}
        title="Maria Alvarez"
        description="APP-1042 · ver_3Zk9QmT2"
        footer={
          <>
            <Button variant="secondary" onClick={drawer.onClose}>
              Ask for more
            </Button>
            <Button onClick={drawer.onClose}>Resolve review</Button>
          </>
        }
      >
        <div className="space-y-5">
          <StatusBadge kind="verification" status="needs_review" />
          <Alert tone="warning" title="Why this needs a person">
            <p>Household income is within 5% of the provisional limit.</p>
          </Alert>
          <KeyValueList dense>
            <KeyValue label="Student">Tomás Alvarez</KeyValue>
            <KeyValue label="Household">4 people · Harris County</KeyValue>
            <KeyValue label="Household income">
              <Money cents={30_480_000} />
            </KeyValue>
            <KeyValue label="Limit used">
              <Money cents={31_200_000} />
            </KeyValue>
            <KeyValue label="Method">Direct — W-2s and pay stubs</KeyValue>
          </KeyValueList>
        </div>
      </Drawer>
    </>
  );
}

export function ConfirmDialogDemo() {
  const confirm = useDisclosure();
  const { toast } = useToast();
  return (
    <>
      <Button variant="danger" onClick={confirm.onOpen}>
        Cancel verification…
      </Button>
      <ConfirmDialog
        open={confirm.open}
        onClose={confirm.onClose}
        tone="danger"
        title="Cancel this verification?"
        description="The family’s link stops working and nothing more is collected. This cannot be undone."
        confirmLabel="Cancel verification"
        cancelLabel="Keep it"
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 700));
          toast({ title: "Verification canceled", tone: "success" });
        }}
      />
    </>
  );
}

export function MoneyInputDemo() {
  const [cents, setCents] = useState<number | null>(170_000);
  return (
    <div className="max-w-xs">
      <Field label="Gift amount" hint="Whole dollars or dollars and cents.">
        <MoneyInput name="amountCents" valueCents={cents} onValueChange={setCents} />
      </Field>
      <Readout label="Emits (integer cents)" value={cents === null ? "null" : String(cents)} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setCents(170_000)}>
          Set $1,700
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setCents(340_000)}>
          Set $3,400
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCents(null)}>
          Clear
        </Button>
      </div>
    </div>
  );
}

export function DateInputDemo() {
  const [iso, setIso] = useState<string | null>("2015-03-09");
  return (
    <div>
      <Fieldset label="Student’s date of birth" hint="For example, 3 9 2015.">
        <DateInput name="dob" value={iso} onChange={(next) => setIso(next)} max="2026-11-18" autoComplete="bday" />
      </Fieldset>
      <Readout label="Emits" value={iso ?? "null (incomplete or not a real date)"} />
    </div>
  );
}

export function OtpInputDemo() {
  const [code, setCode] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <div>
      <Fieldset label="Enter the 6-digit code" hint="We sent it to maria.alvarez@example.com. Paste works too.">
        <OtpInput
          name="code"
          value={code}
          onChange={(next) => {
            setCode(next);
            setDone(null);
          }}
          onComplete={setDone}
        />
      </Fieldset>
      <Readout label="Value" value={code === "" ? "(empty)" : code} />
      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-success-fg">
          <CircleCheck aria-hidden="true" className="size-4" /> onComplete fired with {done}
        </p>
      ) : null}
    </div>
  );
}

const INITIAL_FILES: DropzoneFile[] = [
  { id: "f1", name: "snap-award-letter.pdf", sizeBytes: 482_113, status: "done", detail: "Award letter" },
  { id: "f2", name: "pay-stub-october.jpg", sizeBytes: 2_310_400, status: "uploading", progress: 0.6 },
  { id: "f3", name: "w2-2025-scan.heic", sizeBytes: 5_870_000, status: "error", error: "We couldn’t read this file type. Upload a PDF, JPG or PNG." },
];

const REJECTION_TEXT: Record<FileRejection["reason"], string> = {
  type: "is not a PDF, JPG or PNG",
  too_large: "is larger than 15 MB",
  empty: "is empty",
  too_many: "is over the limit of 6 files",
};

/** Simulates an uploader: the dropzone itself never uploads anything. */
export function FileDropzoneDemo() {
  const [files, setFiles] = useState<DropzoneFile[]>(INITIAL_FILES);
  const [rejected, setRejected] = useState<string[]>([]);
  const timers = useRef<Array<ReturnType<typeof setInterval>>>([]);

  useEffect(() => {
    const running = timers.current;
    return () => running.forEach(clearInterval);
  }, []);

  const simulate = (id: string) => {
    const timer = setInterval(() => {
      setFiles((list) =>
        list.map((file) => {
          if (file.id !== id || file.status !== "uploading") return file;
          const progress = Math.min(1, (file.progress ?? 0) + 0.2);
          return progress >= 1 ? { ...file, status: "done", progress: 1 } : { ...file, progress };
        }),
      );
    }, 500);
    timers.current.push(timer);
    setTimeout(() => clearInterval(timer), 3500);
  };

  return (
    <div className="max-w-xl">
      <FileDropzone
        files={files}
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        maxSizeBytes={15 * 1024 * 1024}
        maxFiles={6}
        capture
        hint="PDF, JPG or PNG, up to 15 MB each. A clear phone photo is fine."
        onFilesAdded={(added) => {
          setRejected([]);
          const rows = added.map((file, index): DropzoneFile => ({ id: `n${files.length}-${index}-${file.name}`, name: file.name, sizeBytes: file.size, status: "uploading", progress: 0 }));
          setFiles((list) => [...list, ...rows]);
          rows.forEach((row) => simulate(row.id));
        }}
        onFilesRejected={(rejections) => setRejected(rejections.map((r) => `${r.file.name} ${REJECTION_TEXT[r.reason]}.`))}
        onRemove={(id) => setFiles((list) => list.filter((file) => file.id !== id))}
        onRetry={(id) => {
          setFiles((list) => list.map((file) => (file.id === id ? { ...file, status: "uploading", progress: 0, error: undefined } : file)));
          simulate(id);
        }}
      />
      {rejected.length > 0 ? (
        <Alert tone="danger" role="alert" className="mt-3" title="Some files were not added">
          <ul className="list-disc pl-5">
            {rejected.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

/** An empty dropzone for the static examples (a server page cannot pass the callbacks itself). Files chosen here are simply listed. */
export function StaticDropzoneDemo(props: Omit<FileDropzoneProps, "files" | "onFilesAdded" | "onRemove">) {
  const [files, setFiles] = useState<DropzoneFile[]>([]);
  return (
    <FileDropzone
      {...props}
      files={files}
      onFilesAdded={(added) => setFiles((list) => [...list, ...added.map((file, index): DropzoneFile => ({ id: `s${list.length}-${index}`, name: file.name, sizeBytes: file.size, status: "queued" }))])}
      onRemove={(id) => setFiles((list) => list.filter((file) => file.id !== id))}
    />
  );
}

export function PathChoiceDemo() {
  const [path, setPath] = useState("upload");
  return (
    <div className="max-w-2xl">
      <Fieldset label="How would you like to show your income?" hint="You can switch at any time. Nothing is lost.">
        <RadioGroup
          name="path"
          variant="cards"
          columns={2}
          value={path}
          onChange={setPath}
          options={[
            { value: "upload", label: "Upload documents", description: "Take a photo or choose a file: an award letter, a tax return, W-2s or pay stubs.", icon: <Upload /> },
            { value: "auto_submit", label: "Connect an account", description: "Sign in to your payroll or bank and we gather last year’s income for you.", icon: <Landmark />, badge: <Badge tone="brand" size="sm">Usually faster</Badge> },
          ]}
        />
      </Fieldset>
      <Readout label="Selected" value={path} />
    </div>
  );
}

/** The canonical server-action form: useActionState + FormError + Field errors + SubmitButton. */
export function ServerFormDemo() {
  const [state, formAction] = useActionState<ActionResult<{ email: string }> | null, FormData>(demoApplyAction, null);
  // React resets uncontrolled inputs after an action; keep what the person typed by controlling the plain inputs.
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);

  if (state?.ok) {
    return (
      <Alert tone="success" role="status" title="Submitted">
        <p>
          The action returned <code className="font-mono text-[0.8125rem]">{`{ ok: true, data: { email: "${state.data.email}" } }`}</code>.
        </p>
      </Alert>
    );
  }

  return (
    <form action={formAction} noValidate className="max-w-lg space-y-5">
      <FormError state={state} fieldLabels={{ email: "Email", amountCents: "Gift amount", dob: "Date of birth", agree: "Agreement" }} fieldIds={{ email: "demo-email", amountCents: "demo-amount", dob: "demo-dob", agree: "demo-agree" }} />
      <Field id="demo-email" label="Email" hint="We send your receipt here." error={fieldError(state, "email")} required>
        <Input type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field id="demo-amount" label="Gift amount" error={fieldError(state, "amountCents")} required>
        <MoneyInput name="amountCents" />
      </Field>
      <Fieldset id="demo-dob" label="Date of birth" error={fieldError(state, "dob")} required>
        <DateInput name="dob" autoComplete="bday" />
      </Fieldset>
      <Checkbox id="demo-agree" name="agree" variant="card" label="I agree to receive my acknowledgment by email" description="You can ask for a paper copy at any time." checked={agree} onChange={(event) => setAgree(event.target.checked)} error={fieldError(state, "agree")} />
      <FormActions align="start">
        <SubmitButton size="lg" pendingText="Checking…" leadingIcon={<FileText />}>
          Submit (try it empty first)
        </SubmitButton>
      </FormActions>
    </form>
  );
}
