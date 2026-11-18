/**
 * tsx scripts/geo-ingest.ts --retrieved-at YYYY-MM-DD [--file <local copy>] [--out data/geo/tx-zcta-county.json]
 *
 * Downloads the Census Bureau 2020 ZCTA-to-county relationship file (or reads a local copy of it), keeps
 * the Texas county parts and writes the compact dataset the geography engine (src/engine/geo) imports.
 * --retrieved-at is required so the output is deterministic: the same input file and date always produce
 * byte-identical JSON.
 *
 * ZCTAs approximate USPS ZIP codes; see src/engine/geo/index.ts for what the data can and cannot prove.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CENSUS_ZCTA_COUNTY_URL, parseZctaCountyRelationship, serializeZctaCountyDataset } from "@/engine/geo/relationship";

const DEFAULT_OUT = "data/geo/tx-zcta-county.json";

async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "retrieved-at": { type: "string" },
      file: { type: "string" },
      out: { type: "string", default: DEFAULT_OUT },
      url: { type: "string", default: CENSUS_ZCTA_COUNTY_URL },
    },
    strict: true,
    allowPositionals: false,
  });
  const retrievedAt = values["retrieved-at"];
  if (!retrievedAt || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt)) {
    throw new Error("--retrieved-at YYYY-MM-DD is required (the date the relationship file was downloaded)");
  }

  let bytes: Buffer;
  if (values.file) {
    bytes = readFileSync(resolve(values.file));
  } else {
    const res = await fetch(values.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${values.url}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dataset = parseZctaCountyRelationship(bytes.toString("utf8"), { url: values.url, retrievedAt, sha256 });

  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, serializeZctaCountyDataset(dataset));
  renameSync(tmp, out);

  const counties = new Set(Object.values(dataset.zctas).flatMap((parts) => parts.map((p) => p.fips)));
  const multi = Object.values(dataset.zctas).filter((parts) => parts.length > 1).length;
  console.log(
    `Wrote ${out}: ${Object.keys(dataset.zctas).length} Texas ZCTAs, ${counties.size} counties, ` +
      `${multi} multi-county ZCTAs, ${Object.keys(dataset.crossState).length} crossing the state line. sha256 ${sha256}`,
  );
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
