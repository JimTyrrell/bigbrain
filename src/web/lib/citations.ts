/**
 * Turn `[n]` / `[1, 2]` citation markers into markdown links `[n](#cite-n)` so the
 * renderer can draw them as chips. Code spans/blocks are left untouched.
 */
export function linkCitations(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\](?![(:])/g, (_m, nums: string) =>
            nums
              .split(/[,;]/)
              .map((n) => `[${n.trim()}](#cite-${n.trim()})`)
              .join(""),
          ),
    )
    .join("");
}
