/**
 * Host lobby settings column: always starts collapsed – first visit, new
 * room, before or after players joined, after a reload. Nothing is
 * remembered, so the server render and the first client render agree
 * (no flash of an open panel). The summary chip shows the setup instead.
 */
export function initialLobbySettingsOpen(): boolean {
  return false;
}
