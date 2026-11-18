import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { addMs, now } from "@/lib/clock";
import { canonicalJson, hashToken, sha256Hex } from "@/lib/crypto";
import { AppError, conflict, forbidden, invalid, isAppError, notFound } from "@/lib/errors";
import { newId, newToken } from "@/lib/ids";
import { audit, SYSTEM_ACTOR, type AuditRequestInfo } from "@/server/audit";
import { cancelPayment, createDonationPayment, getPaymentForClient, type ClientPayment, type PaymentLine } from "@/server/payments";
import { getSettings } from "@/server/settings";
import { assertGiftAllowed, getListStatus, getPublicSgo, getSgoProfile, isGiftableStatus, normalizeStateCode, type GiftListSnapshot } from "@/server/sgos";
import { assertFeeStructureAllowed, COPY_VERSION, renderCopy, type RenderedCopy } from "@/taxmath";
import { findOrCreateDonor, linkSpouses, recordDeliveryConsent } from "./donors";
import { applyConfirmations, CONTRIBUTOR_KEYS, mergeCheckoutForm, parseCheckoutPatch, parseStoredForm, resolveOrder, type CheckoutForm, type CheckoutPatch } from "./form";
import { CHECKOUT_IDLE_TTL_MS } from "./policy";
import {
  allocateCents,
  applicableAttestations,
  buildCheckoutView,
  renderAttestation,
  renderDeliveryConsent,
  renderDesignationStatement,
  type CheckoutContext,
  type CheckoutListContext,
  type CheckoutView,
} from "./view";

/**
 * The donor checkout: start, save as the donor types, place the order. A checkout is reached only through its
 * opaque token (only its hash is stored). Every rule is re-checked on the server when the order is placed: the
 * page's view is a convenience, never trusted.
 *
 *   open ──placeOrder──▶ awaiting_payment ──payment succeeded──▶ completed
 *     ▲                       │ payment failed / canceled, or the donor changes the form (voids the order)
 *     └───────────────────────┘
 *   open ──idle past expiresAt──▶ expired
 */

const { checkoutSessions, donations } = schema;
export type CheckoutSessionRow = typeof checkoutSessions.$inferSelect;
export type DonationRow = typeof donations.$inferSelect;

/* ------------------------------------------------------------------ loading */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

async function loadByToken(token: unknown, db: DbOrTx): Promise<CheckoutSessionRow> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw notFound("Checkout");
  const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.tokenHash, hashToken(token)));
  if (!row) throw notFound("Checkout");
  return row;
}

/** Throws `gone` (and records the expiry) when an open checkout has been idle past its expiry. */
async function assertNotExpired(row: CheckoutSessionRow): Promise<void> {
  if (row.status === "expired") throw new AppError("gone", "This checkout has expired. Start a new one.");
  if (row.status !== "open" || row.expiresAt.getTime() > now().getTime()) return;
  const db = await getDb();
  await db.update(checkoutSessions).set({ status: "expired" }).where(and(eq(checkoutSessions.id, row.id), eq(checkoutSessions.status, "open")));
  throw new AppError("gone", "This checkout has expired. Start a new one.");
}

interface LoadedContext {
  ctx: CheckoutContext;
  /** The list snapshot a gift would rely on right now; null when the list module refuses a gift. */
  snapshot: GiftListSnapshot | null;
  counselMemoRef: string | null;
}

async function loadContext(row: CheckoutSessionRow, at: Date, db: DbOrTx): Promise<LoadedContext> {
  const { org, profile } = await getSgoProfile(row.orgId, db);
  const state = normalizeStateCode(profile.state);
  if (!state) throw new AppError("internal", `SGO ${row.orgId} has an invalid State`);
  let snapshot: GiftListSnapshot | null = null;
  let list: CheckoutListContext;
  try {
    snapshot = await assertGiftAllowed(row.orgId, at, db);
    list = {
      status: snapshot.status,
      source: snapshot.source,
      label: snapshot.label,
      entryId: snapshot.entryId,
      listedFrom: snapshot.listedFrom,
      removedOn: snapshot.removedOn,
      retrievedAt: snapshot.retrievedAt,
      refusal: null,
    };
  } catch (e) {
    if (!isAppError(e) || e.code !== "conflict") throw e;
    const status = await getListStatus(row.orgId, at, db);
    const reason = (e.details as { reason?: string } | undefined)?.reason ?? "refused";
    list = { status: status.status, source: status.source, label: status.label, entryId: status.entryId, listedFrom: status.listedFrom, removedOn: status.removedOn, retrievedAt: null, refusal: { reason, message: e.message } };
  }
  const settings = await getSettings(["credit.startDate", "gifts.liveEnabled", "fees.structure"] as const, db);
  const fees = settings["fees.structure"];
  return {
    snapshot,
    counselMemoRef: fees.counselMemoRef,
    ctx: {
      now: at,
      session: {
        id: row.id,
        mode: row.mode,
        status: row.status,
        source: row.source,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        placedAt: row.placedAt,
        paymentId: row.paymentId,
        orderNumber: row.orderNumber,
      },
      sgo: { orgId: org.id, slug: org.slug, displayName: profile.displayName, legalName: profile.legalName, ein: profile.ein, state, portalRegistered: profile.irsPortalRegistered },
      list,
      settings: {
        creditStartDate: settings["credit.startDate"],
        liveEnabled: settings["gifts.liveEnabled"],
        fees: { active: fees.active, sgoFeeBps: fees.sgoFeeBps, donorServiceFeeBps: fees.donorServiceFeeBps, counselMemoRef: fees.counselMemoRef },
      },
    },
  };
}

/** The view of a checkout row as of now. */
export async function computeCheckoutView(row: CheckoutSessionRow, dbOrTx?: DbOrTx): Promise<CheckoutView> {
  const db = dbOrTx ?? (await getDb());
  const { ctx } = await loadContext(row, now(), db);
  return buildCheckoutView(parseStoredForm(row.form), ctx);
}

/* ------------------------------------------------------------------ start */

export interface StartCheckoutInput {
  sgoSlug: string;
  source: "hosted" | "widget";
  /** The signed-in person, when there is one (their gifts then appear on their page without matching by email). */
  userId?: string | null;
  locale?: "en" | "es" | null;
}

export interface StartCheckoutResult {
  /** Opaque bearer credential for this checkout. Give it to the browser; it is not stored. */
  token: string;
  view: CheckoutView;
}

/**
 * Starts a checkout for an SGO the directory shows (listed and in effect, active, accepting gifts). The mode is
 * "test" unless live gifts are switched on (`gifts.liveEnabled`).
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  if (input?.source !== "hosted" && input?.source !== "widget") throw invalid("Unknown checkout source.", { fields: { source: "Must be hosted or widget." } });
  const db = await getDb();
  const sgo = await getPublicSgo(typeof input.sgoSlug === "string" ? input.sgoSlug : "", db);
  if (!sgo) throw notFound("Organization");
  if (!isGiftableStatus(sgo.list.status)) throw conflict(`${sgo.list.label}. A gift to this organization cannot be accepted.`, { reason: "sgo_not_giftable" });
  const at = now();
  await assertGiftAllowed(sgo.orgId, at, db);
  if (input.userId) {
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.userId));
    if (!user) throw forbidden();
  }
  const settings = await getSettings(["gifts.liveEnabled"] as const, db);
  const mode: Mode = settings["gifts.liveEnabled"] ? "live" : "test";
  const token = newToken();
  const form: CheckoutForm = input.locale ? { locale: input.locale } : {};
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(checkoutSessions)
      .values({
        id: newId("checkout"),
        orgId: sgo.orgId,
        mode,
        status: "open",
        form: form as Record<string, unknown>,
        source: input.source,
        tokenHash: hashToken(token),
        userId: input.userId ?? null,
        lastActivityAt: at,
        expiresAt: addMs(at, CHECKOUT_IDLE_TTL_MS),
        createdAt: at,
      })
      .returning();
    await audit({ actor: SYSTEM_ACTOR, orgId: sgo.orgId, action: "checkout.start", target: { type: "checkout_session", id: inserted[0].id }, metadata: { mode, source: input.source } }, tx);
    return inserted;
  });
  return { token, view: await computeCheckoutView(row, db) };
}

/* ------------------------------------------------------------------ read */

/** The checkout's current view. Throws not_found for an unknown token and gone for an expired checkout. */
export async function getCheckout(token: string): Promise<CheckoutView> {
  const db = await getDb();
  const row = await loadByToken(token, db);
  await assertNotExpired(row);
  return computeCheckoutView(row, db);
}

/** What the browser needs to pay the current order (feed it to `<PaymentForm>`). */
export async function getCheckoutPayment(token: string): Promise<ClientPayment> {
  const db = await getDb();
  const row = await loadByToken(token, db);
  if (!row.paymentId) throw conflict("This checkout has no order to pay yet.");
  return getPaymentForClient(row.paymentId, { checkoutSessionId: row.id, orgId: row.orgId });
}

/* ------------------------------------------------------------------ save */

/**
 * Cancels the current order of a checkout that is awaiting payment, so its form can change: the designation is
 * tied to the payment, so a changed amount needs a new order. Refused once the payment is being processed or paid.
 */
async function voidCurrentOrder(row: CheckoutSessionRow, reason: string): Promise<void> {
  if (row.paymentId) {
    try {
      await cancelPayment(row.paymentId, { checkoutSessionId: row.id, orgId: row.orgId, reason });
    } catch (e) {
      if (isAppError(e) && e.code === "conflict") throw conflict("A payment for this checkout is already being processed or has been paid, so it can no longer be changed.", { reason: "payment_in_progress" });
      throw e;
    }
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, row.id)).for("update");
    if (!locked || locked.status !== "awaiting_payment" || locked.orderNumber !== row.orderNumber) return;
    await tx
      .update(donations)
      .set({ status: "canceled", updatedAt: now() })
      .where(and(eq(donations.checkoutSessionId, row.id), eq(donations.orderNumber, row.orderNumber), inArray(donations.status, ["pending", "failed"])));
    await tx.update(checkoutSessions).set({ status: "open", lastActivityAt: now() }).where(eq(checkoutSessions.id, row.id));
    await audit({ actor: SYSTEM_ACTOR, orgId: row.orgId, action: "checkout.order_voided", target: { type: "checkout_session", id: row.id }, metadata: { orderNumber: row.orderNumber, reason } }, tx);
  });
}

/**
 * Saves part of the form and returns the new view. Fields not in the patch keep their value; `null` clears one.
 * Unknown fields (a Social Security number, a TIN, a note) are refused. Saving a checkout that is awaiting payment
 * voids that order first.
 */
export async function saveCheckout(token: string, patch: CheckoutPatch): Promise<CheckoutView> {
  const parsed = parseCheckoutPatch(patch);
  const db = await getDb();
  let row = await loadByToken(token, db);
  await assertNotExpired(row);
  if (row.status === "completed") throw conflict("This checkout has been paid and can no longer be changed.");
  if (row.status === "canceled") throw conflict("This checkout was canceled.");
  const touchesForm = Object.values(parsed).some((v) => v !== undefined);
  if (row.status === "awaiting_payment" && touchesForm) {
    await voidCurrentOrder(row, "checkout_changed");
    row = await loadByToken(token, db);
  }
  const { ctx } = await loadContext(row, now(), db);
  const saved = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, row.id)).for("update");
    if (!locked) throw notFound("Checkout");
    if (locked.status !== "open" && !(locked.status === "awaiting_payment" && !touchesForm)) throw conflict(`This checkout is ${locked.status} and cannot be changed.`);
    const merged = mergeCheckoutForm(parseStoredForm(locked.form), parsed);
    const order = resolveOrder(merged);
    const locale = merged.locale ?? "en";
    const statement = renderDesignationStatement(order, ctx.sgo.displayName, locale);
    const consentSha = (key: (typeof CONTRIBUTOR_KEYS)[number]) => {
      const contributor = order.contributors.find((c) => c.key === key);
      return contributor ? (renderDeliveryConsent(contributor, ctx.sgo.displayName, locale)?.textSha256 ?? null) : null;
    };
    const form = applyConfirmations(merged, {
      designationConfirmed: parsed.designationConfirmed,
      designationTextSha256: statement?.textSha256 ?? null,
      consents: {
        primary: { requested: parsed.contributors?.primary?.eDeliveryConsent, textSha256: consentSha("primary") },
        spouse: { requested: parsed.contributors?.spouse?.eDeliveryConsent, textSha256: consentSha("spouse") },
      },
    });
    const at = now();
    const [updated] = await tx
      .update(checkoutSessions)
      .set({
        form: form as Record<string, unknown>,
        email: form.email ?? null,
        filingStatus: form.filingStatus ?? null,
        lastActivityAt: at,
        expiresAt: addMs(at, CHECKOUT_IDLE_TTL_MS),
      })
      .where(eq(checkoutSessions.id, locked.id))
      .returning();
    return updated;
  });
  return buildCheckoutView(parseStoredForm(saved.form), { ...ctx, session: { ...ctx.session, status: saved.status, expiresAt: saved.expiresAt } });
}

/* ------------------------------------------------------------------ place the order */

export interface PlaceOrderOptions {
  request?: AuditRequestInfo | null;
  /** The signed-in person placing the order, if any. */
  userId?: string | null;
  /** SHA-256 of the designation words the page showed; refused if the server's words differ. */
  shownDesignationTextSha256?: string | null;
}

export interface PlacedOrder {
  checkoutSessionId: string;
  orderNumber: number;
  donationIds: string[];
  paymentId: string;
  /** What the browser needs to pay. */
  payment: ClientPayment;
  view: CheckoutView;
}

function orderFingerprint(view: CheckoutView, form: CheckoutForm): string {
  return sha256Hex(
    canonicalJson({
      mode: view.mode,
      orgId: view.sgo.orgId,
      filingStatus: view.order.filingStatus,
      contributors: view.order.contributors.map((c) => ({
        role: c.role,
        name: [c.firstName, c.middleName, c.lastName, c.suffix],
        email: c.email,
        designatedCents: c.designatedCents,
        nonDesignatedCents: c.nonDesignatedCents,
        consent: c.eDeliveryConsentTextSha256,
      })),
      email: form.email ?? null,
      address: form.address ?? null,
      attestations: form.attestations ?? null,
      statement: view.designation.statement?.textSha256 ?? null,
      fees: { structure: view.feeStructure, charged: view.totals.chargedCents, serviceFee: view.totals.donorServiceFeeCents, sgoFee: view.totals.sgoInvoicedFeeCents },
      donorTimeZone: view.donorTimeZone,
    }),
  );
}

/**
 * Places the order: final server-side validation of the whole form, a fresh SGO-list check at this moment, the donor
 * rows (one per contributing spouse), the donations with their immutable designation records, then ONE payment for
 * the total with a stable idempotency key. Calling it again for the same order returns the same order and payment.
 */
export async function placeOrder(token: string, options: PlaceOrderOptions = {}): Promise<PlacedOrder> {
  const db = await getDb();
  const row = await loadByToken(token, db);
  await assertNotExpired(row);
  if (row.status === "completed") throw conflict("This checkout has already been paid.");
  if (row.status === "canceled") throw conflict("This checkout was canceled.");
  if (options.userId) {
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, options.userId));
    if (!user) throw forbidden();
  }

  const at = now();
  const { ctx, counselMemoRef } = await loadContext(row, at, db);
  const form = parseStoredForm(row.form);
  const view = buildCheckoutView(form, ctx);
  if (!view.canPlaceOrder) {
    const fields = view.errors;
    const first = Object.values(fields)[0] ?? "Check the form.";
    throw invalid(first, { fields });
  }
  // Re-run the list gate at this moment (not when the page loaded) and keep what it saw as reliance evidence.
  const snapshot = await assertGiftAllowed(row.orgId, at, db);
  if (row.mode === "live" && !ctx.settings.liveEnabled) throw forbidden("Live gifts are not being accepted right now.");
  assertFeeStructureAllowed({ structure: view.feeStructure, counselMemoRef });
  const statement = view.designation.statement as RenderedCopy;
  if (options.shownDesignationTextSha256 && options.shownDesignationTextSha256 !== statement.textSha256) {
    throw conflict("The designation wording has changed. Please read it again.", { reason: "copy_changed" });
  }

  const fingerprint = orderFingerprint(view, form);

  const placed = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, row.id)).for("update");
    if (!locked) throw notFound("Checkout");
    if (locked.status === "completed") throw conflict("This checkout has already been paid.");
    if (locked.status !== "open" && !(locked.status === "awaiting_payment" && locked.orderFingerprint === fingerprint)) {
      throw conflict(`This checkout is ${locked.status} and cannot take a new order.`);
    }
    if (canonicalJson(locked.form) !== canonicalJson(row.form)) throw conflict("The checkout changed while the order was being placed. Review it and try again.", { reason: "form_changed" });
    // Decided under the row lock: a concurrent call (double click, retry) that committed the same order first is
    // reused here rather than racing it into a second order with a second payment.
    const existing =
      locked.orderFingerprint === fingerprint && locked.orderNumber > 0
        ? await tx.select().from(donations).where(and(eq(donations.checkoutSessionId, locked.id), eq(donations.orderNumber, locked.orderNumber), ne(donations.status, "canceled")))
        : [];
    if (existing.length > 0) {
      await tx.update(checkoutSessions).set({ status: "awaiting_payment", lastActivityAt: at }).where(eq(checkoutSessions.id, locked.id));
      return { orderNumber: locked.orderNumber, donationRows: existing };
    }

    const orderNumber = locked.orderNumber + 1;
    const userId = options.userId ?? locked.userId ?? null;
    const [signedInUser] = userId ? await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)) : [];
    const signedIn = signedInUser ? { userId: signedInUser.id, email: signedInUser.email } : null;
    const address = form.address ?? {};
    const contributors = view.order.contributors;
    const weights = contributors.map((c) => c.giftCents);
    const sgoFees = allocateCents(view.totals.sgoInvoicedFeeCents, weights);
    const serviceFees = allocateCents(view.totals.donorServiceFeeCents, weights);
    const attestationProofs = applicableAttestations(view.order).map((a) => {
      const proof = renderAttestation(a.copyId, view.locale);
      return { copyId: proof.id, copyVersion: proof.copyVersion, templateSha256: proof.templateSha256, textSha256: proof.textSha256, text: proof.text, confirmed: form.attestations?.[a.key] === true };
    });
    const eligibilityAtOrder = JSON.parse(JSON.stringify(view.eligibility)) as Record<string, unknown>;
    const relianceAtOrder = { ...snapshot } as unknown as Record<string, unknown>;

    const donors = [];
    for (const c of contributors) {
      donors.push(
        await findOrCreateDonor(
          {
            email: c.email as string,
            firstName: c.firstName as string,
            middleName: c.middleName,
            lastName: c.lastName as string,
            suffix: c.suffix,
            addressLine1: address.line1 as string,
            addressLine2: address.line2 ?? null,
            city: address.city as string,
            state: address.state as string,
            zip: address.zip as string,
          },
          c.key === "primary" ? signedIn : null,
          tx,
        ),
      );
    }
    if (donors.length === 2 && donors[0].id !== donors[1].id) await linkSpouses(donors[0].id, donors[1].id, tx);
    if (donors.length === 2 && donors[0].id === donors[1].id) throw invalid("Each spouse must be entered with their own name.", { fields: { "contributors.spouse.firstName": "Enter the second spouse's own name." } });

    const donationRows: DonationRow[] = [];
    for (const [index, c] of contributors.entries()) {
      const consent = view.consents.find((v) => v.key === c.key);
      const consentRow =
        consent?.given && consent.copy
          ? await recordDeliveryConsent({ donorId: donors[index].id, orgId: row.orgId, mode: row.mode, checkoutSessionId: row.id, email: consent.email as string, rendered: consent.copy, request: options.request }, tx)
          : null;
      const [inserted] = await tx
        .insert(donations)
        .values({
          id: newId("donation"),
          orgId: row.orgId,
          mode: row.mode,
          checkoutSessionId: row.id,
          orderNumber,
          paymentId: null,
          donorId: donors[index].id,
          taxpayerRole: c.role,
          filingStatus: view.order.filingStatus as string,
          designatedAmountCents: c.designatedCents,
          nonDesignatedAmountCents: c.nonDesignatedCents,
          designated25f: true,
          designatedAt: at,
          designationCopyVersion: COPY_VERSION,
          designationCopyId: statement.id,
          designationText: statement.text,
          designationTemplateSha256: statement.templateSha256,
          designationTextSha256: statement.textSha256,
          noEarmarkConfirmed: form.attestations?.noEarmark === true,
          individualConfirmed: form.attestations?.individual === true,
          usCitizenOrResidentConfirmed: form.attestations?.usCitizenOrResident === true,
          notInExchangeConfirmed: form.attestations?.notInExchangeForScholarship === true,
          jointOnBehalfOfBothConfirmed: form.attestations?.jointOnBehalfOfBoth === true,
          attestations: attestationProofs,
          stateAllocation: snapshot.state,
          donorTimeZone: view.donorTimeZone,
          expectedStateCreditCents: c.expectedStateCreditCents,
          feeStructure: view.feeStructure,
          platformFeeCents: sgoFees[index],
          donorServiceFeeCents: serviceFees[index],
          // No goods or services may be attached to a designated gift in this checkout (acknowledgment-reporting.md E1 item 8).
          goodsOrServicesProvided: false,
          goodsOrServicesValueCents: 0,
          status: "pending",
          creditEligible: false,
          relianceAtOrder,
          eligibilityAtOrder,
          eDeliveryConsentId: consentRow?.id ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      donationRows.push(inserted);
    }

    await tx
      .update(checkoutSessions)
      .set({
        status: "awaiting_payment",
        orderNumber,
        orderFingerprint: fingerprint,
        placedAt: at,
        paymentId: null,
        userId,
        email: form.email ?? null,
        filingStatus: form.filingStatus ?? null,
        preview: {
          panel: view.panel,
          totals: view.totals,
          fees: view.fees,
          eligibility: view.eligibility,
          labels: view.labels,
          taxmathVersion: view.preview?.taxmathVersion ?? null,
          copyVersion: COPY_VERSION,
          copyRegistrySha256: view.copyRegistrySha256,
        } as unknown as Record<string, unknown>,
        lastActivityAt: at,
      })
      .where(eq(checkoutSessions.id, row.id));
    await audit(
      {
        actor: options.userId ? { type: "user", id: options.userId } : SYSTEM_ACTOR,
        orgId: row.orgId,
        action: "donation.order_placed",
        target: { type: "checkout_session", id: row.id },
        metadata: {
          orderNumber,
          mode: row.mode,
          donationIds: donationRows.map((d) => d.id),
          designatedCents: view.totals.designatedCents,
          chargedCents: view.totals.chargedCents,
          feeStructure: view.feeStructure,
          designationCopyVersion: COPY_VERSION,
          designationTextSha256: statement.textSha256,
          listEntryId: snapshot.entryId,
        },
        request: options.request,
      },
      tx,
    );
    return { orderNumber, donationRows };
  });

  const lines: PaymentLine[] = placed.donationRows.map((d) => ({
    kind: "designated_contribution",
    amountCents: d.designatedAmountCents,
    description:
      placed.donationRows.length > 1
        ? `${renderCopy("fee.line.designated_contribution")} (${renderCopy(d.taxpayerRole === "spouse_2" ? "panel.heading.spouse_2" : "panel.heading.spouse_1")})`
        : renderCopy("fee.line.designated_contribution"),
  }));
  const serviceFeeCents = placed.donationRows.reduce((sum, d) => sum + d.donorServiceFeeCents, 0);
  if (serviceFeeCents > 0) lines.push({ kind: "donor_service_fee", amountCents: serviceFeeCents, description: renderCopy("fee.line.donor_service_fee") });
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  if (amountCents !== view.totals.chargedCents) throw new AppError("internal", "The payment lines do not add up to the checkout total");

  let payment;
  try {
    payment = await createDonationPayment({
      checkoutSessionId: row.id,
      orgId: row.orgId,
      amountCents,
      lines,
      receiptEmail: form.email ?? null,
      idempotencyKey: `checkout_${row.id}_order_${placed.orderNumber}`,
      mode: row.mode,
    });
  } catch (e) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, row.id)).for("update");
      if (!locked || locked.orderNumber !== placed.orderNumber || locked.paymentId) return;
      await tx
        .update(donations)
        .set({ status: "canceled", failureReason: "The payment could not be created.", updatedAt: now() })
        .where(and(eq(donations.checkoutSessionId, row.id), eq(donations.orderNumber, placed.orderNumber), eq(donations.status, "pending"), isNull(donations.paymentId)));
      await tx.update(checkoutSessions).set({ status: "open" }).where(eq(checkoutSessions.id, row.id));
    });
    throw e;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(donations)
      .set({ paymentId: payment.id, updatedAt: now() })
      .where(and(eq(donations.checkoutSessionId, row.id), eq(donations.orderNumber, placed.orderNumber)));
    await tx.update(checkoutSessions).set({ paymentId: payment.id }).where(and(eq(checkoutSessions.id, row.id), eq(checkoutSessions.orderNumber, placed.orderNumber)));
  });

  const [after] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, row.id));
  return {
    checkoutSessionId: row.id,
    orderNumber: placed.orderNumber,
    donationIds: placed.donationRows.map((d) => d.id),
    paymentId: payment.id,
    payment: payment.client,
    view: buildCheckoutView(parseStoredForm(after.form), {
      ...ctx,
      session: { ...ctx.session, status: after.status, placedAt: after.placedAt, paymentId: after.paymentId, orderNumber: after.orderNumber },
    }),
  };
}
