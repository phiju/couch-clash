"use client";

import { createContext, useContext, useEffect, useState } from "react";

/** Offset between server clock and Date.now(), provided by the room screen. */
export const ClockContext = createContext(0);

/** Current server time, re-rendered every `intervalMs`. */
export function useServerNow(intervalMs = 250): number {
  const offset = useContext(ClockContext);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [offset, intervalMs]);
  return now;
}
