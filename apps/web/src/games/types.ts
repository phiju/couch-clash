import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import type { ComponentType } from "react";

export interface HostViewProps<TState> {
  state: TState;
  room: PublicRoomState;
}

export interface PlayerViewProps<TState> {
  state: TState;
  room: PublicRoomState;
  me: PublicPlayer;
  /** Sends a category action to the room (validated there). */
  sendAction: (action: unknown) => void;
}

/** The UI half of a category module. The logic half lives in packages/games. */
export interface GameViews<TState = never> {
  HostView: ComponentType<HostViewProps<TState>>;
  PlayerView: ComponentType<PlayerViewProps<TState>>;
}
