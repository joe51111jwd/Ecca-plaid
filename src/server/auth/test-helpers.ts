import { listOutbox } from "@/server/email";

/** Test-only: reads the newest sign-in email sent to an address and pulls out its token and code. */
export async function readSignInEmail(to: string): Promise<{ token: string; code: string; text: string; subject: string }> {
  const [email] = await listOutbox({ to, template: "magic_link", limit: 1 });
  if (!email) throw new Error(`no sign-in email for ${to}`);
  const token = /token=([A-Za-z0-9_-]{43})/.exec(email.text)?.[1];
  const afterLabel = email.text.split(/Your code|Su código/)[1] ?? "";
  const code = /(\d{6})/.exec(afterLabel)?.[1];
  if (!token || !code) throw new Error("sign-in email is missing its token or code");
  return { token, code, text: email.text, subject: email.subject };
}
