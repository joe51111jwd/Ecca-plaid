import { BRAND } from "@/lib/brand";
import type { EmailLocale } from "@/server/email";

/** Email copy for inviting a second adult to a household, English and Spanish. Short: read on phones. */
export interface HouseholdInvitationCopy {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta: string;
  footerNote: string;
}

export function householdInvitationCopy(locale: EmailLocale, inviterEmail: string | null): HouseholdInvitationCopy {
  if (locale === "es") {
    return {
      subject: `Le agregaron a un hogar en ${BRAND.name}`,
      heading: "Le agregaron a un hogar",
      paragraphs: [
        inviterEmail
          ? `${inviterEmail} le agregó como persona adulta de su hogar en ${BRAND.name}, donde se revisan los ingresos del hogar para becas escolares.`
          : `Le agregaron como persona adulta de un hogar en ${BRAND.name}, donde se revisan los ingresos del hogar para becas escolares.`,
        "Al iniciar sesión con este correo, podrá ver la información del hogar y subir documentos. Solo la persona a cargo del hogar puede dar permiso para compartir el resultado.",
        "Para entrar, toque el botón y pida un enlace de inicio de sesión. No necesita contraseña.",
      ],
      cta: "Iniciar sesión",
      footerNote: "Si no conoce a esta persona o no esperaba este correo, puede ignorarlo.",
    };
  }
  return {
    subject: `You were added to a household on ${BRAND.name}`,
    heading: "You were added to a household",
    paragraphs: [
      inviterEmail
        ? `${inviterEmail} added you as an adult in their household on ${BRAND.name}, where household income is checked for school scholarships.`
        : `You were added as an adult in a household on ${BRAND.name}, where household income is checked for school scholarships.`,
      "When you sign in with this email address, you can see the household's information and upload documents. Only the adult in charge of the household can give permission to share the result.",
      "To get in, tap the button and ask for a sign-in link. There is no password.",
    ],
    cta: "Sign in",
    footerNote: "If you do not know this person or were not expecting this, you can ignore this email.",
  };
}
