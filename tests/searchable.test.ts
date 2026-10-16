import { describe, expect, it } from "vitest";
import { SEARCHABLE_FALLBACK_MS, becameSearchable, toMillis } from "../src/worker/lib/ingest";

describe("searchable refresh", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const rows = [
    { id: "old", vector_written_at: "2026-10-16T11:58:00.000Z" },
    { id: "edge", vector_written_at: "2026-10-16T11:59:00.000Z" },
    { id: "new", vector_written_at: "2026-10-16T11:59:30.000Z" },
  ];

  it("marks rows written at or before processedUpToDatetime", () => {
    expect(becameSearchable(rows, "2026-10-16T11:59:00.000Z", now)).toEqual(["old", "edge"]);
    expect(becameSearchable(rows, Date.parse("2026-10-16T11:59:00.000Z"), now)).toEqual(["old", "edge"]);
  });

  it("keeps rows pending when Vectorize has not caught up or describe failed", () => {
    expect(becameSearchable(rows, "2026-10-16T11:00:00.000Z", now)).toEqual([]);
    expect(becameSearchable(rows, null, now)).toEqual([]);
  });

  it("falls back to searchable after the safety window, or when no write time is known", () => {
    const later = Date.parse("2026-10-16T11:58:00.000Z") + SEARCHABLE_FALLBACK_MS + 1;
    expect(becameSearchable(rows, null, later)).toEqual(["old"]);
    expect(becameSearchable([{ id: "x", vector_written_at: null }], null, now)).toEqual(["x"]);
  });

  it("parses ISO strings and epoch seconds or milliseconds", () => {
    expect(toMillis("2026-10-16T12:00:00.000Z")).toBe(now);
    expect(toMillis(now)).toBe(now);
    expect(toMillis(now / 1000)).toBe(now);
    expect(toMillis("nope")).toBeNull();
    expect(toMillis(undefined)).toBeNull();
  });
});
