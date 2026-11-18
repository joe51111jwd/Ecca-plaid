import type { UiLocale } from "@/components/ui";

/** Screen copy for sign-in and sign-out, English and Spanish. */
export interface SignInCopy {
  title: string;
  intro: string;
  emailLabel: string;
  emailHint: string;
  sendLink: string;
  sending: string;
  checkTitle: string;
  checkBody: (email: string) => string;
  codeLabel: string;
  codeHint: string;
  verify: string;
  verifying: string;
  useOtherEmail: string;
  resend: string;
  resent: string;
  linkInvalidTitle: string;
  linkInvalidBody: string;
  rateLimitedTitle: string;
  rateLimitedBody: string;
  signedOut: string;
  invalidEmail: string;
  invalidCode: string;
  genericError: string;
  signOutTitle: string;
  signOutBody: (email: string) => string;
  signOutButton: string;
  signOutPending: string;
  signOutCancel: string;
  notSignedIn: string;
  goToSignIn: string;
}

const en: SignInCopy = {
  title: "Sign in",
  intro: "Enter your email. We will send you a link and a 6-digit code. No password needed.",
  emailLabel: "Email address",
  emailHint: "Use the same email each time so you come back to the same account.",
  sendLink: "Email me a sign-in link",
  sending: "Sending…",
  checkTitle: "Check your email",
  checkBody: (email) => `We sent a link and a 6-digit code to ${email}. They expire in 15 minutes. Tap the link, or type the code here.`,
  codeLabel: "6-digit code",
  codeHint: "The code is in the same email as the link.",
  verify: "Sign in",
  verifying: "Checking…",
  useOtherEmail: "Use a different email",
  resend: "Send a new link",
  resent: "We sent a new link and code. Use the newest email.",
  linkInvalidTitle: "That link did not work",
  linkInvalidBody: "Sign-in links expire after 15 minutes and work only once. Enter your email to get a new one.",
  rateLimitedTitle: "Too many tries",
  rateLimitedBody: "Please wait a few minutes, then try again.",
  signedOut: "You are signed out.",
  invalidEmail: "Enter a valid email address.",
  invalidCode: "That code did not work. Check the code in your newest email, or ask for a new one.",
  genericError: "Something went wrong. Please try again.",
  signOutTitle: "Sign out",
  signOutBody: (email) => `You are signed in as ${email}. Sign out on this device?`,
  signOutButton: "Sign out",
  signOutPending: "Signing out…",
  signOutCancel: "Stay signed in",
  notSignedIn: "You are not signed in.",
  goToSignIn: "Go to sign in",
};

const es: SignInCopy = {
  title: "Iniciar sesión",
  intro: "Escriba su correo electrónico. Le enviaremos un enlace y un código de 6 dígitos. No necesita contraseña.",
  emailLabel: "Correo electrónico",
  emailHint: "Use siempre el mismo correo para volver a la misma cuenta.",
  sendLink: "Enviarme un enlace para entrar",
  sending: "Enviando…",
  checkTitle: "Revise su correo",
  checkBody: (email) => `Enviamos un enlace y un código de 6 dígitos a ${email}. Vencen en 15 minutos. Toque el enlace o escriba el código aquí.`,
  codeLabel: "Código de 6 dígitos",
  codeHint: "El código está en el mismo correo que el enlace.",
  verify: "Entrar",
  verifying: "Revisando…",
  useOtherEmail: "Usar otro correo",
  resend: "Enviar un enlace nuevo",
  resent: "Enviamos un enlace y un código nuevos. Use el correo más reciente.",
  linkInvalidTitle: "Ese enlace no funcionó",
  linkInvalidBody: "Los enlaces vencen a los 15 minutos y se pueden usar una sola vez. Escriba su correo para recibir uno nuevo.",
  rateLimitedTitle: "Demasiados intentos",
  rateLimitedBody: "Espere unos minutos y vuelva a intentarlo.",
  signedOut: "Usted cerró la sesión.",
  invalidEmail: "Escriba un correo electrónico válido.",
  invalidCode: "Ese código no funcionó. Revise el código en su correo más reciente o pida uno nuevo.",
  genericError: "Algo salió mal. Vuelva a intentarlo.",
  signOutTitle: "Cerrar sesión",
  signOutBody: (email) => `Usted entró como ${email}. ¿Cerrar la sesión en este dispositivo?`,
  signOutButton: "Cerrar sesión",
  signOutPending: "Cerrando sesión…",
  signOutCancel: "Seguir en la sesión",
  notSignedIn: "Usted no ha iniciado sesión.",
  goToSignIn: "Ir a iniciar sesión",
};

export function signInCopy(locale: UiLocale): SignInCopy {
  return locale === "es" ? es : en;
}

export function parseLocale(value: unknown): UiLocale {
  return value === "es" ? "es" : "en";
}

/** First value of a search param. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
