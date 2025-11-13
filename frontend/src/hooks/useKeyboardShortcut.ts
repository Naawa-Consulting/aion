"use client";

import { useEffect } from "react";

type Options = {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export function useKeyboardShortcut(key: string, handler: (event: KeyboardEvent) => void, options: Options = {}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (options.ctrl && !(event.metaKey || event.ctrlKey)) return;
      if (options.alt && !event.altKey) return;
      if (options.shift && !event.shiftKey) return;
      if (event.key.toLowerCase() === key.toLowerCase()) {
        handler(event);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, handler, options.ctrl, options.alt, options.shift]);
}

