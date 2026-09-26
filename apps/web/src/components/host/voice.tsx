"use client";

import type { ClientMessage, HostLine } from "@couch-clash/shared";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/mascot";
import { getAudioEngine } from "@/lib/audio/engine";
import { PARTY_HTTP_URL } from "@/lib/config";
import { VoicePlayer } from "@/lib/voice/player";
import { lineAudioPaths } from "@/lib/voice/sequence";

/** What the host mascot is saying right now (null = silent). */
export const HostSpeechContext = createContext<HostLine | null>(null);

export function useHostSpeech(): HostLine | null {
  return useContext(HostSpeechContext);
}

/**
 * Plays the host's lines one after another (host device only). Audio goes
 * through the audio engine (music ducked). Without audio (locked, file
 * failed) a line is skipped – there are no subtitles.
 * Reports start/end to the server (welcome queue, leaderboard hold).
 */
export function useHostVoice(send: (msg: ClientMessage) => void, clockOffset: number) {
  const [current, setCurrent] = useState<HostLine | null>(null);
  const sendRef = useRef(send);
  const offsetRef = useRef(clockOffset);
  useEffect(() => {
    sendRef.current = send;
    offsetRef.current = clockOffset;
  }, [send, clockOffset]);

  // Created in an effect (not during render); lines arrive via onLine later.
  const playerRef = useRef<VoicePlayer | null>(null);
  useEffect(() => {
    const player = new VoicePlayer({
      play: (line) => {
        const engine = getAudioEngine();
        if (!engine.unlocked) return Promise.resolve(null);
        // Name clip + line ("Max …" – "Wolltest du überhaupt hierher?"), seamlessly.
        const urls = lineAudioPaths(line).map((path) => `${PARTY_HTTP_URL}${path}`);
        return engine.playVoiceSequence(urls, line.prefixGapMs ?? 0, line.playbackRate);
      },
      report: (event) => sendRef.current({ type: "voice_event", ...event }),
      onCurrent: setCurrent,
      serverNow: () => Date.now() + offsetRef.current,
      interrupt: () => getAudioEngine().fadeOutVoice(),
    });
    playerRef.current = player;
    return () => {
      player.stop();
      playerRef.current = null;
      getAudioEngine().stopVoice();
    };
  }, []);

  const onLine = useCallback((line: HostLine) => playerRef.current?.enqueue(line), []);
  return { current, onLine };
}

/**
 * While a line plays: the host slides in bottom left and bounces (no
 * bubble) – on screens that don't show him anyway. Lobby, intro and
 * finale let their own mascot talk.
 */
export function HostSpeaker({ className = "" }: { className?: string }) {
  const line = useHostSpeech();
  if (!line) return null;
  return (
    <div className={`host-speaker pointer-events-none fixed bottom-0 left-[1.5vw] z-40 ${className}`}>
      <Mascot
        key={line.id}
        pose="announce"
        talking
        imageClassName="h-[min(40vh,440px)]"
      />
    </div>
  );
}
