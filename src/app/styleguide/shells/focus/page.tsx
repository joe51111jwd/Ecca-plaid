import { Landmark, Upload } from "lucide-react";
import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Alert, Badge, Banner, Button, DefinitionTooltip, Fieldset, FormActions, LanguageToggle, RadioGroup, Stepper, TextLink } from "@/components/ui";
import { SAMPLE_SGO } from "../../_data";
import { GUIDE_METADATA } from "../../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Shell demo — family step" };

/** Sample page copy. Real family copy lives in src/i18n; only the kit's own chrome is translated by `locale`. */
const COPY = {
  en: {
    banner: "Style-guide demo with sample data. Nothing is saved.",
    steps: ["Consent", "Household", "Income", "Review"],
    title: "How would you like to show your income?",
    lead: "Choose whichever is easier for you. You can switch at any time without starting over.",
    legend: "Choose one",
    upload: "Upload documents",
    uploadBody: "Take a photo or choose a file: a benefits award letter, a tax return, W-2s or pay stubs.",
    connect: "Connect an account",
    connectBody: "Sign in to your payroll or bank and we gather last year’s income for you.",
    faster: "Usually faster",
    term: "benefits award letter",
    termBody: "A letter from a benefits office saying someone in your home is approved for SNAP, TANF, WIC, Section 8 or SSI. It must be dated within the last 12 months.",
    termLead: "Not sure what counts? See what a",
    termTail: "is.",
    note: "Checking your income does not guarantee a scholarship. The scholarship organization decides.",
    next: "Continue",
    later: "Save and finish later",
    help: "Get help",
    privacy: "How we use your information",
  },
  es: {
    banner: "Demostración de la guía de estilo con datos de ejemplo. No se guarda nada.",
    steps: ["Consentimiento", "Hogar", "Ingresos", "Revisión"],
    title: "¿Cómo quiere mostrar sus ingresos?",
    lead: "Elija la opción que le resulte más fácil. Puede cambiar en cualquier momento sin empezar de nuevo.",
    legend: "Elija una opción",
    upload: "Subir documentos",
    uploadBody: "Tome una foto o elija un archivo: una carta de beneficios, una declaración de impuestos, formularios W-2 o talones de pago.",
    connect: "Conectar una cuenta",
    connectBody: "Inicie sesión en su nómina o banco y reunimos por usted los ingresos del año pasado.",
    faster: "Suele ser más rápido",
    term: "carta de beneficios",
    termBody: "Una carta de una oficina de beneficios que indica que alguien de su hogar está aprobado para SNAP, TANF, WIC, Sección 8 o SSI. Debe tener fecha de los últimos 12 meses.",
    termLead: "¿No sabe qué documentos sirven? Vea qué es una",
    termTail: ".",
    note: "Verificar sus ingresos no garantiza una beca. La organización de becas decide.",
    next: "Continuar",
    later: "Guardar y terminar después",
    help: "Obtener ayuda",
    privacy: "Cómo usamos su información",
  },
} as const;

const STEP_IDS = ["consent", "household", "income", "review"] as const;

export default async function FocusShellDemo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = (await searchParams).lang === "es" ? "es" : "en";
  const t = COPY[locale];
  const base = "/styleguide/shells/focus";
  return (
    <FocusShell
      locale={locale}
      banner={<Banner tone="sandbox">{t.banner}</Banner>}
      partner={{ name: SAMPLE_SGO.name }}
      languageToggle={<LanguageToggle current={locale} hrefs={{ en: base, es: `${base}?lang=es` }} />}
      progress={<Stepper locale={locale} current="income" steps={STEP_IDS.map((id, index) => ({ id, label: t.steps[index], href: index < 2 ? base : undefined }))} />}
      back={{ href: "/styleguide/shells" }}
      secureNote="family"
      footer={
        <>
          <TextLink href="/styleguide/shells" tone="quiet" standalone>
            {t.help}
          </TextLink>
          <TextLink href="/styleguide/shells" tone="quiet" standalone>
            {t.privacy}
          </TextLink>
        </>
      }
    >
      <h1 className="font-display text-display-sm text-balance text-fg">{t.title}</h1>
      <p className="mt-3 text-base text-fg-muted">{t.lead}</p>
      <form className="mt-6 space-y-6">
        <Fieldset label={t.legend} hideLabel locale={locale}>
          <RadioGroup
            name="path"
            variant="cards"
            defaultValue="upload"
            options={[
              { value: "upload", label: t.upload, description: t.uploadBody, icon: <Upload /> },
              {
                value: "auto_submit",
                label: t.connect,
                description: t.connectBody,
                icon: <Landmark />,
                badge: (
                  <Badge tone="brand" size="sm">
                    {t.faster}
                  </Badge>
                ),
              },
            ]}
          />
        </Fieldset>
        <p className="text-base text-fg-muted">
          {t.termLead} <DefinitionTooltip term={t.term} definition={t.termBody} locale={locale} />
          {t.termTail === "." ? "." : ` ${t.termTail}`}
        </p>
        <Alert tone="neutral">
          <p>{t.note}</p>
        </Alert>
        <FormActions align="start">
          <Button size="lg" href="/styleguide/shells">
            {t.next}
          </Button>
          <Button size="lg" variant="ghost" href="/styleguide/shells">
            {t.later}
          </Button>
        </FormActions>
      </form>
    </FocusShell>
  );
}
