/**
 * Test tools on the host screen ("🤖 Testspieler hinzufügen"): only with
 * ?test=1 in the URL or when the admin token is present in this browser.
 */
export function testModeEnabled(search: string, adminToken: string | null | undefined): boolean {
  return new URLSearchParams(search).get("test") === "1" || !!adminToken;
}
