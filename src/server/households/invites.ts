import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { conflict, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { normalizeEmail, type User } from "@/server/auth";
import { renderEmail, sendEmail } from "@/server/email";
import { requirePermission, type HouseholdActor } from "./access";
import { householdInvitationCopy } from "./copy";
import { toMemberView, type HouseholdMemberView } from "./members";

/** Where an invited adult lands after signing in. */
export const FAMILY_HOME_PATH = "/family";

export interface InviteAdultInput {
  email: string;
  /** The adult's existing member row (add the person with addMember first). */
  memberId: string;
}

export interface InviteAdultResult {
  member: HouseholdMemberView;
  user: Pick<User, "id" | "email">;
  /** True when no account existed for the address; one was created and is used on first sign-in. */
  isNewUser: boolean;
}

/**
 * Links a second adult's sign-in to their member row and emails them a sign-in invitation. Accounts are one
 * per email address, so the link is made to the account for that address (created if needed); as soon as
 * that person signs in, assertHouseholdAccess gives them "adult" access. Adults can view the household and
 * add documents, never grant the sharing consent (see HOUSEHOLD_PERMISSIONS).
 *
 * Refused (conflict) when the address belongs to the owner, is already linked to another member here, or
 * belongs to someone who owns or is linked to a different household: each person has one durable household.
 * Re-inviting the same person to the same row re-sends the email.
 */
export async function inviteAdult(householdId: string, input: InviteAdultInput, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<InviteAdultResult> {
  const email = normalizeEmail(input.email);
  const db = dbOrTx ?? (await getDb());

  const result = await db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "invite_adult");
    const household = access.household;
    const hm = schema.householdMembers;
    const [member] =
      typeof input.memberId === "string" && input.memberId
        ? await tx
            .select()
            .from(hm)
            .where(and(eq(hm.id, input.memberId), eq(hm.householdId, household.id), isNull(hm.removedAt)))
            .for("update")
            .limit(1)
        : [];
    if (!member) throw notFound("Household member");
    if (member.isOwner) throw conflict("This is your own row; you are already signed in.");
    if (member.kind !== "adult") throw conflict("Only an adult in the household can have their own sign-in.", { fields: { memberId: "Choose an adult." } });

    let isNewUser = false;
    let [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!user) {
      const inserted = await tx.insert(schema.users).values({ id: newId("user"), email, locale: household.locale, createdAt: now() }).onConflictDoNothing({ target: schema.users.email }).returning();
      if (inserted[0]) {
        user = inserted[0];
        isNewUser = true;
      } else {
        [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      }
    }
    if (user.id === household.ownerUserId) throw conflict("That is your own email address.", { fields: { email: "Use the other adult's email address." } });
    if (member.userId && member.userId !== user.id) throw conflict("This adult is already linked to a different sign-in. Remove them and add them again to change it.");

    const [elsewhere] = await tx
      .select({ id: hm.id })
      .from(hm)
      .where(and(eq(hm.userId, user.id), isNull(hm.removedAt), ne(hm.id, member.id)))
      .limit(1);
    const [ownsOther] = await tx.select({ id: schema.households.id }).from(schema.households).where(eq(schema.households.ownerUserId, user.id)).limit(1);
    if (elsewhere || ownsOther) throw conflict("That person already belongs to a household on this service.", { fields: { email: "Already in a household." } });

    const relinked = member.userId === user.id;
    const [linked] = relinked ? [member] : await tx.update(hm).set({ userId: user.id }).where(eq(hm.id, member.id)).returning();
    await tx.update(schema.households).set({ updatedAt: now() }).where(eq(schema.households.id, household.id));
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: "household.adult_invite",
        target: { type: "household_member", id: member.id },
        metadata: { householdId: household.id, invitedUserId: user.id, newUser: isNewUser, resent: relinked },
        request: actor.request,
      },
      tx,
    );
    const [inviter] = await tx.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
    return { member: linked, user, isNewUser, locale: household.locale, inviterEmail: inviter?.email ?? null };
  });

  const locale = result.locale === "es" ? "es" : "en";
  const copy = householdInvitationCopy(locale, result.inviterEmail);
  const signInUrl = appUrl(`/sign-in?email=${encodeURIComponent(email)}&next=${encodeURIComponent(FAMILY_HOME_PATH)}${locale === "es" ? "&lang=es" : ""}`);
  const rendered = renderEmail({ locale, heading: copy.heading, paragraphs: copy.paragraphs, cta: { label: copy.cta, url: signInUrl }, footerNote: copy.footerNote });
  await sendEmail({ to: email, subject: copy.subject, template: "household_invitation", html: rendered.html, text: rendered.text, related: { type: "household_member", id: result.member.id } }, db);

  return { member: toMemberView(result.member), user: { id: result.user.id, email: result.user.email }, isNewUser: result.isNewUser };
}
