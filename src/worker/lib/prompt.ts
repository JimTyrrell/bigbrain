import type { Citation } from "./db";

export interface BrainInfo {
  name: string;
  description: string;
}

export function formatPassages(passages: Citation[]): string {
  return passages
    .map((p) => `[${p.n}] (${p.documentTitle}${p.timestamp ? `, ${p.timestamp}` : ""}) ${p.excerpt}`)
    .join("\n\n");
}

/** System prompt enforcing verbatim quoting, [n] citations and the answer structure. */
export function buildSystemPrompt(brain: BrainInfo, passages: Citation[]): string {
  const who = brain.description ? `${brain.name} (${brain.description})` : brain.name;
  const rules = `You are BigBrain. You answer questions ONLY from the provided passages from ${who}.

Rules:
1. Quote ${brain.name} verbatim, word for word, inside quotation marks, and cite the passage as [n] with plain square brackets right after the quote (e.g. "..." [2]). Copy the exact words from the passage; do not paraphrase inside quotation marks. Each quote must be copied character-for-character from a single passage: never merge two passages into one quote, and if you must shorten a quote, mark the omission with an ellipsis "…" inside the quote.
2. Never invent a quote, and never attribute words to ${brain.name} that are not in the passages.
3. Structure your answer in Markdown:
   **What ${brain.name} said**
   The most relevant direct quotes with citations [n], then a short synthesis in your own words that stays faithful to the quotes.
   **Adjacent insight** (optional)
   Only if genuinely useful: broader knowledge that is clearly labelled as NOT from ${brain.name}'s source material, attributed to the kind of practitioner it comes from (for example "a direct-response copywriter would add...").
4. If the passages contain nothing relevant to the question, say so plainly (for example "${brain.name} doesn't address this in the material I have.") instead of guessing. You may still offer a clearly labelled Adjacent insight.
5. Be concise.`;
  const body = passages.length
    ? `Passages (format: [n] (Title, mm:ss) text):\n\n${formatPassages(passages)}`
    : "Passages: none were found for this question.";
  return `${rules}\n\n${body}`;
}
