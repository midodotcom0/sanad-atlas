import { describe, expect, it } from "vitest";
import { diffMatnWords } from "../lib/matn-diff";

describe("Arabic word diff", () => {
  it("ignores diacritics while preserving source tokens", () => {
    expect(diffMatnWords("إِنَّمَا الأعمال", "انما الأعمال")).toEqual([{ kind: "equal", before: ["إِنَّمَا", "الأعمال"], after: ["انما", "الأعمال"] }]);
  });

  it("distinguishes additions, omissions and replacements", () => {
    expect(diffMatnWords("إنما الأعمال بالنيات", "إنما الأعمال بالنية وزيادة").map((item) => item.kind)).toEqual(["equal", "replacement"]);
    expect(diffMatnWords("قال زيد", "قال زيد اليوم").at(-1)?.kind).toBe("addition");
    expect(diffMatnWords("قال زيد اليوم", "قال زيد").at(-1)?.kind).toBe("omission");
  });

  it("labels moved vocabulary as a reorder rather than a new word", () => {
    expect(diffMatnWords("قال زيد عن عمرو", "قال عمرو عن زيد").some((item) => item.kind === "reorder")).toBe(true);
  });
});
