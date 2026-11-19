/** Hidden inputs that tell a server action which flow a form belongs to. Works in server and client components. */
export function HiddenFields({ values }: { values: Record<string, string | null | undefined> }) {
  return (
    <>
      {Object.entries(values).map(([name, value]) => (value === null || value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />))}
    </>
  );
}

/** The fields every intake form posts: the flow's base path, the verification and the language. */
export interface FlowFormFields {
  base: string;
  v: string;
  lang: "en" | "es";
}
