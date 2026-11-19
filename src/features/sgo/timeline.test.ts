import { describe, expect, it } from "vitest";
import { roleLabel } from "./labels";
import { timelineActor, timelineLabel } from "./timeline";

describe("timeline words", () => {
  it("labels known events and never hides unknown ones", () => {
    expect(timelineLabel("review.resolved")).toBe("Reviewer resolved the verification");
    expect(timelineLabel("document.purged")).toBe("Raw file deleted under the retention policy");
    expect(timelineLabel("rail.report_received")).toBe("Rail report received");
    expect(timelineLabel("")).toBe("Event");
  });

  it("names staff from the team map and everyone else by kind", () => {
    const names = new Map([["usr_1", "Dana Reviewer"]]);
    expect(timelineActor("user", "usr_1", names)).toBe("Dana Reviewer");
    expect(timelineActor("user", "usr_gone", names)).toBe("Staff member");
    expect(timelineActor("api_key", "key_1", names)).toBe("API key");
    expect(timelineActor("family", null, names)).toBe("Family");
    expect(timelineActor("martian", null, names)).toBe("Unknown");
  });

  it("role labels", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("viewer")).toBe("Viewer");
  });
});
