/**
 * States whose SGO lists can appear in the product, and the calendar each one's dates are read in.
 *
 * Section 25F lists are per "State", which the temporary regulations define as the 50 States and the District
 * of Columbia (docs/reference/acknowledgment-reporting.md, F48).
 */

interface StateInfo {
  name: string;
  /**
   * POLICY (the sources are silent on time zones): a list date such as a removal's effective date is a calendar
   * date in the State's own context, and for a State that spans zones we read it in the zone of its capital.
   * Texas (Austin) is US Central.
   */
  timeZone: string;
}

const NY = "America/New_York";
const CHI = "America/Chicago";
const DEN = "America/Denver";
const LA = "America/Los_Angeles";

export const US_STATES = {
  AL: { name: "Alabama", timeZone: CHI },
  AK: { name: "Alaska", timeZone: "America/Juneau" },
  AZ: { name: "Arizona", timeZone: "America/Phoenix" },
  AR: { name: "Arkansas", timeZone: CHI },
  CA: { name: "California", timeZone: LA },
  CO: { name: "Colorado", timeZone: DEN },
  CT: { name: "Connecticut", timeZone: NY },
  DE: { name: "Delaware", timeZone: NY },
  DC: { name: "District of Columbia", timeZone: NY },
  FL: { name: "Florida", timeZone: NY },
  GA: { name: "Georgia", timeZone: NY },
  HI: { name: "Hawaii", timeZone: "Pacific/Honolulu" },
  ID: { name: "Idaho", timeZone: "America/Boise" },
  IL: { name: "Illinois", timeZone: CHI },
  IN: { name: "Indiana", timeZone: "America/Indiana/Indianapolis" },
  IA: { name: "Iowa", timeZone: CHI },
  KS: { name: "Kansas", timeZone: CHI },
  KY: { name: "Kentucky", timeZone: NY },
  LA: { name: "Louisiana", timeZone: CHI },
  ME: { name: "Maine", timeZone: NY },
  MD: { name: "Maryland", timeZone: NY },
  MA: { name: "Massachusetts", timeZone: NY },
  MI: { name: "Michigan", timeZone: "America/Detroit" },
  MN: { name: "Minnesota", timeZone: CHI },
  MS: { name: "Mississippi", timeZone: CHI },
  MO: { name: "Missouri", timeZone: CHI },
  MT: { name: "Montana", timeZone: DEN },
  NE: { name: "Nebraska", timeZone: CHI },
  NV: { name: "Nevada", timeZone: LA },
  NH: { name: "New Hampshire", timeZone: NY },
  NJ: { name: "New Jersey", timeZone: NY },
  NM: { name: "New Mexico", timeZone: DEN },
  NY: { name: "New York", timeZone: NY },
  NC: { name: "North Carolina", timeZone: NY },
  ND: { name: "North Dakota", timeZone: CHI },
  OH: { name: "Ohio", timeZone: NY },
  OK: { name: "Oklahoma", timeZone: CHI },
  OR: { name: "Oregon", timeZone: LA },
  PA: { name: "Pennsylvania", timeZone: NY },
  RI: { name: "Rhode Island", timeZone: NY },
  SC: { name: "South Carolina", timeZone: NY },
  SD: { name: "South Dakota", timeZone: CHI },
  TN: { name: "Tennessee", timeZone: CHI },
  TX: { name: "Texas", timeZone: CHI },
  UT: { name: "Utah", timeZone: DEN },
  VT: { name: "Vermont", timeZone: NY },
  VA: { name: "Virginia", timeZone: NY },
  WA: { name: "Washington", timeZone: LA },
  WV: { name: "West Virginia", timeZone: NY },
  WI: { name: "Wisconsin", timeZone: CHI },
  WY: { name: "Wyoming", timeZone: DEN },
} as const satisfies Record<string, StateInfo>;

export type UsStateCode = keyof typeof US_STATES;

export const US_STATE_CODES = Object.keys(US_STATES) as UsStateCode[];

export function isUsStateCode(value: unknown): value is UsStateCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(US_STATES, value);
}

/** "tx", " TX " → "TX"; anything that is not one of the 50 States or DC → null. */
export function normalizeStateCode(value: unknown): UsStateCode | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return isUsStateCode(code) ? code : null;
}

export function stateName(code: UsStateCode): string {
  return US_STATES[code].name;
}

/** The calendar date (YYYY-MM-DD) of an instant in a State's reference zone. */
export function stateDateString(at: Date, state: UsStateCode): string {
  return dateStringInZone(at, US_STATES[state].timeZone);
}

export function dateStringInZone(at: Date, timeZone: string): string {
  if (Number.isNaN(at.getTime())) throw new RangeError("Invalid date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
