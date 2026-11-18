"use client";

import { FlaskConical } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Checkbox, Fieldset, Money, RadioGroup, Spinner } from "@/components/ui";
import type { LinkSessionPayload } from "@/server/rails/types";
import { loadPlaidLink, plaidExitResult, plaidSuccessResult, type PlaidLinkHandler } from "./plaid-link";
import { initialRailConnectState, railConnectReducer, shouldOfferUpload } from "./state";
import type { RailConnectActions, RailConnectionView, RailConnectStrings, RailConsentText } from "./types";

/**
 * Auto-submit, embedded in the family flow: the rail_connect consent, then the provider's own screen (the
 * simulated sandbox picker, or Plaid Link loaded only now), then progress and the outcome. "Upload documents
 * instead" is visible in every state and never loses anything already entered: the toggle is a preference,
 * not a trap.
 *
 * The component reports what the provider's screen said; the server validates it and decides. Nothing here
 * is the record of the income (that is the stored report).
 */

export interface RailConnectProps {
  locale: "en" | "es";
  strings: RailConnectStrings;
  /** The consent exactly as `previewRailConsent` rendered it. */
  consent: RailConsentText;
  actions: RailConnectActions;
  /** The escape hatch: switch the family to the upload path. */
  onUploadInstead: () => void;
  /** Called once when a connection reaches an outcome (ready, failed, declined, revoked). */
  onFinished?: (connection: RailConnectionView) => void;
  /** A connection already made on this verification, to show its state on reload. */
  initialConnection?: RailConnectionView | null;
  /** How often to ask the server while the provider prepares the data. */
  pollIntervalMs?: number;
}

export const DEFAULT_RAIL_POLL_INTERVAL_MS = 4000;

export function RailConnect({ locale, strings, consent, actions, onUploadInstead, onFinished, initialConnection, pollIntervalMs = DEFAULT_RAIL_POLL_INTERVAL_MS }: RailConnectProps) {
  const [state, dispatch] = useReducer(railConnectReducer, initialConnection ?? null, initialRailConnectState);
  const actionsRef = useRef(actions);
  const finishedRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstPhase = useRef(true);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  // Move focus to the heading when the step changes, so screen-reader and keyboard users follow along.
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [state.phase]);

  const connectionId = state.connection?.id ?? null;

  useEffect(() => {
    if (state.phase !== "waiting" || !connectionId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      actionsRef.current
        .refresh(connectionId)
        .then((result) => {
          if (!cancelled && result.ok) dispatch({ type: "updated", connection: result.data });
        })
        .catch(() => {
          // A missed poll is retried on the next tick.
        });
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state.phase, connectionId, pollIntervalMs]);

  useEffect(() => {
    if (state.phase === "done" && state.connection && finishedRef.current !== state.connection.id) {
      finishedRef.current = state.connection.id;
      onFinished?.(state.connection);
    }
  }, [state.phase, state.connection, onFinished]);

  const run = useCallback(
    async <T,>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, onOk: (data: T) => void) => {
      try {
        const result = await call();
        if (result.ok) onOk(result.data);
        else dispatch({ type: "error", message: result.error.message || strings.errorGeneric });
      } catch {
        dispatch({ type: "error", message: strings.errorGeneric });
      }
    },
    [strings.errorGeneric],
  );

  const start = useCallback(() => {
    dispatch({ type: "start" });
    void run(
      () => actionsRef.current.start({ shownSha256: consent.sha256 }),
      (data) => dispatch({ type: "started", connection: data.connection, client: data.client }),
    );
  }, [consent.sha256, run]);

  const complete = useCallback(
    (clientResult: unknown) => {
      if (!connectionId) return;
      dispatch({ type: "complete" });
      void run(
        () => actionsRef.current.complete(connectionId, clientResult),
        (connection) => dispatch({ type: "updated", connection }),
      );
    },
    [connectionId, run],
  );

  const decline = useCallback(() => {
    if (!connectionId) return;
    dispatch({ type: "complete" });
    void run(
      () => actionsRef.current.decline(connectionId),
      (connection) => dispatch({ type: "updated", connection }),
    );
  }, [connectionId, run]);

  const offerUpload = shouldOfferUpload(state);

  return (
    <Card as="section" padding="lg" aria-labelledby="rail-connect-heading" className="space-y-5">
      <h2 id="rail-connect-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-fg focus:outline-none">
        {strings.heading}
      </h2>

      <div aria-live="polite" className="space-y-5">
        {state.error ? (
          <Alert tone="danger" role="alert" title={state.error} />
        ) : null}

        {state.phase === "intro" || state.phase === "starting" ? <ConsentStep strings={strings} consent={consent} busy={state.phase === "starting"} onConnect={start} /> : null}

        {(state.phase === "provider" || state.phase === "completing") && state.client ? (
          <ProviderStep locale={locale} strings={strings} client={state.client} busy={state.phase === "completing"} onComplete={complete} onDecline={decline} />
        ) : null}

        {state.phase === "waiting" ? (
          <div role="status" className="flex items-start gap-3">
            <Spinner size="md" />
            <div>
              <p className="font-semibold text-fg">{strings.waitingTitle}</p>
              <p className="text-sm text-fg-muted">{strings.waitingBody}</p>
            </div>
          </div>
        ) : null}

        {state.phase === "done" && state.connection ? <Outcome locale={locale} strings={strings} connection={state.connection} onRetry={() => dispatch({ type: "retry" })} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant={offerUpload ? "primary" : "secondary"} size={offerUpload ? "lg" : "md"} onClick={onUploadInstead} data-testid="rail-upload-instead">
          {strings.uploadInstead}
        </Button>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------- steps */

function ConsentStep({ strings, consent, busy, onConnect }: { strings: RailConnectStrings; consent: RailConsentText; busy: boolean; onConnect: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [showError, setShowError] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-fg">{strings.intro}</p>
      <div className="space-y-2 rounded-card border border-line bg-sunken p-4 text-sm text-fg">
        <h3 className="font-semibold">{consent.title}</h3>
        {consent.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <Checkbox
        variant="card"
        label={consent.checkboxLabel}
        checked={agreed}
        onChange={(e) => {
          setAgreed(e.currentTarget.checked);
          if (e.currentTarget.checked) setShowError(false);
        }}
        error={showError ? strings.consentRequired : null}
        disabled={busy}
      />
      <Button
        size="lg"
        loading={busy}
        loadingText={strings.connecting}
        onClick={() => {
          if (!agreed) {
            setShowError(true);
            return;
          }
          onConnect();
        }}
      >
        {strings.connectButton}
      </Button>
    </div>
  );
}

function ProviderStep(props: { locale: "en" | "es"; strings: RailConnectStrings; client: LinkSessionPayload; busy: boolean; onComplete: (clientResult: unknown) => void; onDecline: () => void }) {
  if (props.client.provider === "simulated") return <SimulatedPicker {...props} client={props.client} />;
  return <PlaidLauncher strings={props.strings} client={props.client} busy={props.busy} onComplete={props.onComplete} />;
}

function SimulatedPicker({ locale, strings, client, busy, onComplete, onDecline }: { locale: "en" | "es"; strings: RailConnectStrings; client: Extract<LinkSessionPayload, { provider: "simulated" }>; busy: boolean; onComplete: (clientResult: unknown) => void; onDecline: () => void }) {
  const [persona, setPersona] = useState(client.personas[0]?.id ?? "");
  return (
    <Card tone="caution" padding="md" className="hatch space-y-4" id="rail-sandbox-picker">
      <div>
        <p className="flex items-center gap-2 text-base font-semibold tracking-wide text-caution-fg uppercase" data-testid="rail-sandbox-heading">
          <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
          {strings.sandboxHeading}
        </p>
        <p className="mt-1 text-sm text-caution-fg">{strings.sandboxExplanation}</p>
      </div>
      <Fieldset label={strings.choosePersona}>
        <RadioGroup
          name="rail-persona"
          value={persona}
          onChange={setPersona}
          disabled={busy}
          options={client.personas.map((p) => ({ value: p.id, label: p.label[locale], description: p.description[locale] }))}
        />
      </Fieldset>
      <div className="flex flex-wrap gap-3">
        <Button loading={busy} disabled={!persona} onClick={() => onComplete({ persona })}>
          {strings.continueButton}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDecline}>
          {strings.declineButton}
        </Button>
      </div>
    </Card>
  );
}

function PlaidLauncher({ strings, client, busy, onComplete }: { strings: RailConnectStrings; client: Extract<LinkSessionPayload, { provider: "plaid" }>; busy: boolean; onComplete: (clientResult: unknown) => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const handler = useRef<PlaidLinkHandler | null>(null);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    loadPlaidLink()
      .then((Plaid) => {
        if (cancelled) return;
        handler.current = Plaid.create({
          token: client.linkToken,
          onSuccess: (publicToken) => completeRef.current(plaidSuccessResult(publicToken)),
          onExit: (error, metadata) => completeRef.current(plaidExitResult(error, metadata)),
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      handler.current?.destroy?.();
      handler.current = null;
    };
  }, [client.linkToken]);

  if (status === "failed") {
    return (
      <Alert tone="warning" role="alert" title={strings.plaidLoadFailed} />
    );
  }
  return (
    <div className="space-y-3">
      {client.sandbox ? (
        <Badge tone="caution" icon={<FlaskConical />}>
          {strings.sandboxBadge}
        </Badge>
      ) : null}
      <Button size="lg" loading={status === "loading" || busy} loadingText={status === "loading" ? strings.plaidLoading : strings.connecting} onClick={() => handler.current?.open()}>
        {strings.plaidOpenButton}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------------------- outcome */

function Outcome({ locale, strings, connection, onRetry }: { locale: "en" | "es"; strings: RailConnectStrings; connection: RailConnectionView; onRetry: () => void }) {
  const reason = connection.failureMessage?.[locale] ?? null;
  const retry = (
    <Button variant="secondary" onClick={onRetry}>
      {strings.tryAgain}
    </Button>
  );
  let alert: ReactNode;
  switch (connection.status) {
    case "ready":
      alert = connection.offerUpload ? (
        <Alert tone="warning" role="status" title={strings.readyTitle}>
          <p>{strings.readyNeedsUpload}</p>
        </Alert>
      ) : (
        <Alert tone="success" role="status" title={strings.readyTitle}>
          <p>{strings.readyBody}</p>
        </Alert>
      );
      break;
    case "declined":
      alert = (
        <Alert tone="info" role="status" title={strings.declinedTitle} actions={retry}>
          {reason ? <p>{reason}</p> : null}
        </Alert>
      );
      break;
    case "revoked":
      alert = (
        <Alert tone="neutral" role="status" title={strings.revokedTitle}>
          {reason ? <p>{reason}</p> : null}
        </Alert>
      );
      break;
    default:
      alert = (
        <Alert tone="danger" role="alert" title={strings.failedTitle} actions={retry}>
          <p>{reason ?? strings.errorGeneric}</p>
        </Alert>
      );
  }
  return (
    <div className="space-y-4" data-testid={`rail-outcome-${connection.status}`}>
      {alert}
      {connection.retrieved && connection.retrieved.sources.length > 0 ? <Retrieved strings={strings} connection={connection} /> : null}
    </div>
  );
}

function Retrieved({ strings, connection }: { strings: RailConnectStrings; connection: RailConnectionView }) {
  const sources = connection.retrieved?.sources ?? [];
  return (
    <section aria-label={strings.retrievedCaption} className="rounded-card border border-line">
      <h3 className="border-b border-line px-4 py-2 text-sm font-semibold text-fg">{strings.retrievedCaption}</h3>
      <ul className="divide-y divide-line">
        {sources.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="min-w-0">
              <span className="block font-medium text-fg">{s.employerName ?? strings.sourceTypeLabels[s.type]}</span>
              <span className="block text-fg-muted">
                {strings.sourceTypeLabels[s.type]} · {s.taxYear}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <Money cents={s.grossAnnualCents} />
              <Badge tone={s.counted ? "success" : "neutral"}>{s.counted ? strings.countedLabel : strings.notCountedLabel}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
