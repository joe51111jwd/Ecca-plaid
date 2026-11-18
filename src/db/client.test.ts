import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { useTestDb } from "../../tests/helpers/db";

describe("database", () => {
  const t = useTestDb();

  it("creates the full schema and round-trips a row through getDb()", async () => {
    const db = await getDb();
    expect(db).toBe(t.db);
    const id = newId("user");
    await db.insert(schema.users).values({ id, email: "a@example.com" });
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(row.email).toBe("a@example.com");
    expect(row.locale).toBe("en");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("truncates between tests and supports transactions with rollback", async () => {
    const db = await getDb();
    expect(await db.select().from(schema.users)).toHaveLength(0);
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.users).values({ id: newId("user"), email: "b@example.com" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });
});
