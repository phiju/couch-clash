/**
 * Developer mode for the /dev pages: on in `next dev`, in production once
 * with ?dev=1 (remembered on this device, ?dev=0 turns it off again).
 */
const DEV_KEY = "couchclash:dev";

export function devModeOn(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  try {
    const flag = new URLSearchParams(window.location.search).get("dev");
    if (flag === "1") window.localStorage.setItem(DEV_KEY, "1");
    if (flag === "0") window.localStorage.removeItem(DEV_KEY);
    return window.localStorage.getItem(DEV_KEY) === "1";
  } catch {
    return false;
  }
}
