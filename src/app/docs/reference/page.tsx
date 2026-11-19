import type { Metadata } from "next";
import { Badge, Button } from "@/components/ui";
import { OPERATION_IDS, OPERATIONS, type OperationDefinition } from "@/server/api";
import { DocsHeader, DocsSection, Endpoint, RefTable } from "../_components";

export const metadata: Metadata = { title: "Endpoints & OpenAPI" };

const WHO: Record<string, string> = { sgo: "SGO", business: "Business" };

export default function ReferencePage() {
  const ops = OPERATION_IDS.map((id) => ({ id, ...(OPERATIONS[id] as OperationDefinition) }));
  const tags = [...new Set(ops.map((o) => o.tag))];
  return (
    <>
      <DocsHeader
        eyebrow="Reference"
        title="Endpoints and the OpenAPI document"
        lead={<p>Every endpoint of API v1. The machine-readable OpenAPI 3.1 description is generated from the same definitions the server validates requests with.</p>}
      />
      <div className="flex flex-wrap gap-3">
        <Button href="/api/v1/openapi.json">OpenAPI JSON</Button>
        <Button href="/openapi/v1.json" variant="secondary">
          Static copy
        </Button>
      </div>
      {tags.map((tag) => (
        <DocsSection key={tag} id={tag.toLowerCase().replace(/\s+/g, "-")} title={tag}>
          <RefTable
            caption={`${tag} endpoints`}
            head={["endpoint", "summary", "keys"]}
            rows={ops
              .filter((o) => o.tag === tag)
              .map((o) => [
                <Endpoint key={o.id} method={o.method} path={`/api/v1${o.path}`} />,
                o.summary,
                o.public ? (
                  <Badge key="p" tone="neutral" size="sm">
                    public
                  </Badge>
                ) : (
                  o.orgTypes.map((t) => WHO[t]).join(", ")
                ),
              ])}
          />
        </DocsSection>
      ))}
    </>
  );
}
