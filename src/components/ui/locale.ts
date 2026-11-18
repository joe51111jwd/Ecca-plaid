/**
 * Built-in wording of the kit's own chrome (button labels, screen-reader text, the provisional notice)
 * in English and Spanish. Family-facing components take `locale`; everything can be overridden per
 * instance through a `labels` prop. Page copy does not belong here — it lives in src/i18n.
 */
export type UiLocale = "en" | "es";

export interface UiStrings {
  close: string;
  cancel: string;
  confirm: string;
  back: string;
  previous: string;
  next: string;
  copy: string;
  copied: string;
  copyFailed: string;
  show: string;
  hide: string;
  loading: string;
  required: string;
  optional: string;
  menu: string;
  language: string;
  errorSummaryTitle: string;
  notifications: string;
  dismiss: string;
  progress: string;
  stepOf: (current: number, total: number) => string;
  stepCompleted: string;
  stepCurrent: string;
  month: string;
  day: string;
  year: string;
  monthPlaceholder: string;
  dayPlaceholder: string;
  yearPlaceholder: string;
  otpDigit: (index: number, total: number) => string;
  dropzoneTitle: string;
  dropzoneTitleTouch: string;
  dropzoneBrowse: string;
  dropzoneTakePhoto: string;
  dropzoneDropHere: string;
  fileQueued: string;
  fileUploading: string;
  fileDone: string;
  fileError: string;
  fileRemove: (name: string) => string;
  fileRetry: (name: string) => string;
  filesHeading: string;
  provisional: string;
  provisionalTitle: string;
  provisionalBody: string;
  secureNote: string;
  secureNoteFamily: string;
  secureNoteDonor: string;
  definitionOf: (term: string) => string;
  sortAscending: string;
  sortDescending: string;
  sortNone: string;
  sandboxMode: string;
  liveMode: string;
  skipToContent: string;
}

const en: UiStrings = {
  close: "Close",
  cancel: "Cancel",
  confirm: "Confirm",
  back: "Back",
  previous: "Previous",
  next: "Next",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  show: "Show",
  hide: "Hide",
  loading: "Loading",
  required: "required",
  optional: "optional",
  menu: "Menu",
  language: "Language",
  errorSummaryTitle: "There is a problem",
  notifications: "Notifications",
  dismiss: "Dismiss",
  progress: "Progress",
  stepOf: (current, total) => `Step ${current} of ${total}`,
  stepCompleted: "Completed",
  stepCurrent: "Current step",
  month: "Month",
  day: "Day",
  year: "Year",
  monthPlaceholder: "MM",
  dayPlaceholder: "DD",
  yearPlaceholder: "YYYY",
  otpDigit: (index, total) => `Digit ${index} of ${total}`,
  dropzoneTitle: "Drag files here, or choose files",
  dropzoneTitleTouch: "Choose files from your phone",
  dropzoneBrowse: "Choose files",
  dropzoneTakePhoto: "Take a photo",
  dropzoneDropHere: "Drop files to add them",
  fileQueued: "Waiting",
  fileUploading: "Uploading",
  fileDone: "Uploaded",
  fileError: "Could not upload",
  fileRemove: (name) => `Remove ${name}`,
  fileRetry: (name) => `Try ${name} again`,
  filesHeading: "Files",
  provisional: "Provisional",
  provisionalTitle: "This income limit is provisional",
  provisionalBody:
    "It is calculated from HUD income-limit data because the IRS has not yet published its own limits for the federal scholarship tax credit. It may change when the IRS publishes them.",
  secureNote: "Your information is protected and shared only with the organization you choose.",
  secureNoteFamily: "Your documents are stored encrypted and shared only with the organization you approve.",
  secureNoteDonor: "Card details go straight to the payment processor and are never stored here.",
  definitionOf: (term) => `What does “${term}” mean?`,
  sortAscending: "sorted ascending",
  sortDescending: "sorted descending",
  sortNone: "not sorted",
  sandboxMode: "Test mode",
  liveMode: "Live",
  skipToContent: "Skip to main content",
};

const es: UiStrings = {
  close: "Cerrar",
  cancel: "Cancelar",
  confirm: "Confirmar",
  back: "Atrás",
  previous: "Anterior",
  next: "Siguiente",
  copy: "Copiar",
  copied: "Copiado",
  copyFailed: "No se pudo copiar",
  show: "Mostrar",
  hide: "Ocultar",
  loading: "Cargando",
  required: "obligatorio",
  optional: "opcional",
  menu: "Menú",
  language: "Idioma",
  errorSummaryTitle: "Hay un problema",
  notifications: "Notificaciones",
  dismiss: "Descartar",
  progress: "Progreso",
  stepOf: (current, total) => `Paso ${current} de ${total}`,
  stepCompleted: "Completado",
  stepCurrent: "Paso actual",
  month: "Mes",
  day: "Día",
  year: "Año",
  monthPlaceholder: "MM",
  dayPlaceholder: "DD",
  yearPlaceholder: "AAAA",
  otpDigit: (index, total) => `Dígito ${index} de ${total}`,
  dropzoneTitle: "Arrastre sus archivos aquí o elija archivos",
  dropzoneTitleTouch: "Elija archivos de su teléfono",
  dropzoneBrowse: "Elegir archivos",
  dropzoneTakePhoto: "Tomar una foto",
  dropzoneDropHere: "Suelte los archivos para agregarlos",
  fileQueued: "En espera",
  fileUploading: "Subiendo",
  fileDone: "Subido",
  fileError: "No se pudo subir",
  fileRemove: (name) => `Quitar ${name}`,
  fileRetry: (name) => `Intentar de nuevo con ${name}`,
  filesHeading: "Archivos",
  provisional: "Provisional",
  provisionalTitle: "Este límite de ingresos es provisional",
  provisionalBody:
    "Se calcula con datos de límites de ingresos de HUD porque el IRS aún no ha publicado sus propios límites para el crédito fiscal federal para becas. Puede cambiar cuando el IRS los publique.",
  secureNote: "Su información está protegida y solo se comparte con la organización que usted elija.",
  secureNoteFamily: "Sus documentos se guardan cifrados y solo se comparten con la organización que usted apruebe.",
  secureNoteDonor: "Los datos de la tarjeta van directamente al procesador de pagos y nunca se guardan aquí.",
  definitionOf: (term) => `¿Qué significa “${term}”?`,
  sortAscending: "orden ascendente",
  sortDescending: "orden descendente",
  sortNone: "sin ordenar",
  sandboxMode: "Modo de prueba",
  liveMode: "En vivo",
  skipToContent: "Saltar al contenido principal",
};

export const UI_STRINGS: Record<UiLocale, UiStrings> = { en, es };

/** Strings for a locale, with optional per-instance overrides. */
export function uiStrings(locale: UiLocale = "en", overrides?: Partial<UiStrings>): UiStrings {
  return overrides ? { ...UI_STRINGS[locale], ...overrides } : UI_STRINGS[locale];
}
