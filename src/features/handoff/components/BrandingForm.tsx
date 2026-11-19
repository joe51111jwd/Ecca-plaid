"use client";

import { useState } from "react";
import { Field, Input, LogoMark, OrgMark } from "@/components/ui";
import type { PortalActionState } from "../types";
import { ActionForm } from "./ActionForm";

export interface BrandingFormProps {
  orgId: string;
  initial: { displayName: string; brandColor: string | null; logoUrl: string | null };
  action: (previous: PortalActionState, formData: FormData) => Promise<PortalActionState>;
  productName: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Name, brand color and logo, with a live preview of how the family's handoff page shows them beside ours. The
 * service checks the color has enough contrast for white text and that the logo is an https address.
 */
export function BrandingForm({ orgId, initial, action, productName }: BrandingFormProps) {
  const [name, setName] = useState(initial.displayName);
  const [color, setColor] = useState(initial.brandColor ?? "");
  const [logo, setLogo] = useState(initial.logoUrl ?? "");
  const previewColor = HEX.test(color) ? color : null;
  const previewLogo = /^https:\/\/\S+$/.test(logo) ? logo : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <ActionForm action={action} submitLabel="Save branding" fieldLabels={{ displayName: "Name shown to families", brandColor: "Brand color", logoUrl: "Logo URL" }}>
        <input type="hidden" name="orgId" value={orgId} />
        <Field label="Name shown to families">
          <Input name="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </Field>
        <Field label="Brand color" hint="A dark color: white text must be readable on it. Leave blank for none.">
          {(control) => (
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick a brand color" value={previewColor ?? "#1f5c3f"} onChange={(e) => setColor(e.target.value)} className="h-control-md w-12 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-1" />
              <Input {...control} name="brandColor" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#1F5C3F" maxLength={7} spellCheck={false} />
            </div>
          )}
        </Field>
        <Field label="Logo URL" hint="An https address of a square image. Leave blank to show your initials." optional>
          <Input name="logoUrl" type="url" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://www.camp.example.org/logo.png" />
        </Field>
      </ActionForm>

      <figure aria-label="Preview of the family's handoff page header" className="self-start rounded-panel border border-line bg-canvas p-4">
        <figcaption className="mb-3 text-xs font-semibold tracking-wide text-fg-subtle uppercase">Preview</figcaption>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
            <LogoMark size="sm" />
            <span className="font-semibold text-fg">{productName}</span>
            <span className="flex min-w-0 items-center gap-2 border-l border-line pl-2">
              <OrgMark name={name || "Your business"} logoUrl={previewLogo} size="sm" />
              <span className="truncate font-medium text-fg">{name || "Your business"}</span>
            </span>
          </div>
          <div className="space-y-3 p-3">
            {previewColor ? <div aria-hidden="true" className="h-1.5 rounded-full" style={{ backgroundColor: previewColor }} /> : null}
            <p className="font-display text-lg text-fg">Check whether your household may qualify</p>
            <p className="text-xs text-fg-muted">A partner scholarship organization can check if you qualify.</p>
            <span className="inline-flex h-9 items-center rounded-control bg-action px-3 text-sm font-semibold text-action-fg">Check if I qualify</span>
          </div>
        </div>
      </figure>
    </div>
  );
}
