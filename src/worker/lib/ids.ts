const ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

/** 21-char nanoid-style id. */
export function newId(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (const b of bytes) id += ALPHABET[b & 63];
  return id;
}

export const nowIso = () => new Date().toISOString();
