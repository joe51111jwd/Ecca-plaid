import { BRAND } from "@/lib/brand";
import type { EmailLocale } from "@/server/email";

/** Sign-in and invitation email copy, English and Spanish. Short and plain: these are read on phones. */

export interface SignInEmailCopy {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  cta: string;
  codeLabel: string;
  footerNote: string;
}

export function signInEmailCopy(locale: EmailLocale, expiresInMinutes: number): SignInEmailCopy {
  if (locale === "es") {
    return {
      subject: `Su enlace para iniciar sesión en ${BRAND.name}`,
      preheader: `Vence en ${expiresInMinutes} minutos y se puede usar una sola vez.`,
      heading: "Inicie sesión",
      paragraphs: [
        `Toque el botón para iniciar sesión en ${BRAND.name}. O escriba el código de 6 dígitos en la pantalla donde lo pidió.`,
        `El enlace y el código vencen en ${expiresInMinutes} minutos y se pueden usar una sola vez.`,
      ],
      cta: "Iniciar sesión",
      codeLabel: "Su código",
      footerNote: "Si usted no pidió esto, ignore este correo. Nadie puede entrar a su cuenta sin este enlace o código.",
    };
  }
  return {
    subject: `Your ${BRAND.name} sign-in link`,
    preheader: `It expires in ${expiresInMinutes} minutes and can be used once.`,
    heading: "Sign in",
    paragraphs: [
      `Tap the button to sign in to ${BRAND.name}. Or type the 6-digit code on the screen where you asked for it.`,
      `The link and the code expire in ${expiresInMinutes} minutes and can be used once.`,
    ],
    cta: "Sign in",
    codeLabel: "Your code",
    footerNote: "If you did not ask for this, ignore this email. No one can get into your account without this link or code.",
  };
}

export interface InvitationEmailCopy {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta: string;
  footerNote: string;
}

const ROLE_NAMES: Record<EmailLocale, Record<string, string>> = {
  en: { owner: "owner", admin: "admin", reviewer: "reviewer", viewer: "viewer" },
  es: { owner: "propietario", admin: "administrador", reviewer: "revisor", viewer: "lector" },
};

export function invitationEmailCopy(locale: EmailLocale, orgName: string, role: string, inviterEmail: string | null): InvitationEmailCopy {
  const roleName = ROLE_NAMES[locale][role] ?? role;
  if (locale === "es") {
    return {
      subject: `Le agregaron a ${orgName} en ${BRAND.name}`,
      heading: `Bienvenido a ${orgName}`,
      paragraphs: [
        inviterEmail ? `${inviterEmail} le agregó a ${orgName} en ${BRAND.name} con el rol de ${roleName}.` : `Le agregaron a ${orgName} en ${BRAND.name} con el rol de ${roleName}.`,
        "Para entrar, toque el botón y pida un enlace de inicio de sesión con este correo. No necesita contraseña.",
      ],
      cta: "Iniciar sesión",
      footerNote: "Si no esperaba esta invitación, puede ignorar este correo.",
    };
  }
  return {
    subject: `You were added to ${orgName} on ${BRAND.name}`,
    heading: `Welcome to ${orgName}`,
    paragraphs: [
      inviterEmail ? `${inviterEmail} added you to ${orgName} on ${BRAND.name} as ${roleName}.` : `You were added to ${orgName} on ${BRAND.name} as ${roleName}.`,
      "To get in, tap the button and ask for a sign-in link with this email address. There is no password.",
    ],
    cta: "Sign in",
    footerNote: "If you were not expecting this, you can ignore this email.",
  };
}
