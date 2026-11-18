import { text, timestamp } from "drizzle-orm/pg-core";

/** Primary key: prefixed random id from `newId()` (src/lib/ids.ts). */
export const pk = () => text("id").primaryKey();
/** Timestamp with time zone, mapped to JS Date. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const createdAt = () => ts("created_at").notNull().defaultNow();
export const updatedAt = () => ts("updated_at").notNull().defaultNow();

/** `test` data never mixes with `live` data in API responses, exports or reports. */
export type Mode = "test" | "live";
