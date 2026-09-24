"use client";

import type { ClientMessage, HostLine } from "@couch-clash/shared";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/mascot";
import { getAudioEngine } from "@/lib/audio/engine";
import { PARTY_HTTP_URL } from "@/lib/config";
import { VoicePlayer } from "@/lib/voice/player";

/** What the host mascot is saying right now (null = silent). */
export const HostSpeechContext = createContext<HostLine | null>(null);

export function useHostSpeech(): HostLine | null {
  return useContext(HostSpeechContext);
}

/**
 * Plays the host's lines one after another (host device only). Audio goes
 * through the audio engine (music ducked); without audio – locked, muted
 * or the speech failed – the line is shown as a subtitle for a reading time.
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
        return line.audioPath && engine.unlocked
          ? engine.playVoice(`${PARTY_HTTP_URL}${line.audioPath}`)
          : Promise.resolve(null);
      },
      report: (event) => sendRef.current({ type: "voice_event", ...event }),
      onCurrent: setCurrent,
      serverNow: () => Date.now() + offsetRef.current,
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
 * The host with a speech bubble, bottom left – for screens that don't show
 * him anyway. Lobby, intro and finale put the line into their own mascot.
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
        message={line.text}
        imageClassName="h-[min(40vh,440px)]"
        bubbleClassName="fs-xl !bottom-[86%] !left-[62%] max-w-[min(38rem,58vw)]"
      />
    </div>
  );
}
