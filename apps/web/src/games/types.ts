import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import type { ComponentType } from "react";
import type { ModuleAudioScene } from "@/lib/audio/scenes";

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
  /**
   * Music/sound on the host while this category plays. Return
   * `{ music: null }` for no background music (e.g. music rounds that play
   * their own audio through the audio engine). Omit for the lobby loop.
   */
  audio?: (state: TState) => ModuleAudioScene | null;
}
