import { useLayoutEffect, type RefObject } from "react";

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 240) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [ref, value, maxPx]);
}
