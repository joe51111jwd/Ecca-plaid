/**
 * What a family can do on its handoff page, holding only the handoff token (no account): choose among the business's
 * partner SGOs, or stop the scholarship check. The token is the credential; the handoffs service checks it, the
 * partnership and the handoff's state.
 */
import { z } from "zod";
import type { AuditRequestInfo } from "@/server/audit";
import { cancelHandoffByFamily, chooseHandoffSgo, isWellFormedHandoffToken } from "@/server/handoffs";
import { invalid, notFound, type ActionResult } from "@/lib/errors";

type Result = ActionResult<{ message: string }>;

const chooseSchema = z.object({
  token: z.string(),
  sgoOrgId: z.string().trim().min(1, "Choose a scholarship organization.").max(128, "Choose a scholarship organization."),
  locale: z.enum(["en", "es"]).catch("en"),
});

function tokenOf(formData: FormData): string {
  const token = formData.get("token");
  if (!isWellFormedHandoffToken(token)) throw notFound("Handoff");
  return token;
}

export async function chooseSgoOp(formData: FormData, request: AuditRequestInfo | null): Promise<Result> {
  const token = tokenOf(formData);
  const parsed = chooseSchema.safeParse({ token, sgoOrgId: formData.get("sgoOrgId") ?? "", locale: formData.get("locale") ?? "en" });
  if (!parsed.success) throw invalid("Choose a scholarship organization.", { fields: { sgoOrgId: parsed.error.issues[0]?.message ?? "Choose a scholarship organization." } });
  await chooseHandoffSgo(token, parsed.data.sgoOrgId, { locale: parsed.data.locale, request });
  return { ok: true, data: { message: "saved" } };
}

export async function cancelByFamilyOp(formData: FormData, request: AuditRequestInfo | null): Promise<Result> {
  await cancelHandoffByFamily(tokenOf(formData), { request });
  return { ok: true, data: { message: "canceled" } };
}
