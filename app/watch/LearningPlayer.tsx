"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EMPTY_LEARNING, type LearningState, type LearningVideo } from "@/lib/learning/model";
import { LearningButtons, useLearning } from "@/app/learning/LearningControls";

type Player = {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(position: number, allowSeekAhead: boolean): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  destroy(): void;
};
type PlayerApi = { Player: new (element: HTMLIFrameElement, options: {
  events: { onReady(event: { target: Player }): void; onStateChange(event: { data: number; target: Player }): void };
}) => Player };
declare global {
  interface Window {
    YT?: PlayerApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<PlayerApi> | null = null;
function loadPlayerApi(): Promise<PlayerApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<PlayerApi>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Playback tracking is unavailable.")), 12_000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timer);
      if (window.YT) resolve(window.YT);
    };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("Playback tracking is unavailable."));
    }, { once: true });
  }).catch((error) => { apiPromise = null; throw error; });
  return apiPromise;
}

/** `heading` (the title and facts) sits between the player and the controls, where viewers expect it. */
export function LearningPlayer({ video, initial = EMPTY_LEARNING, signedIn, heading }: {
  video: LearningVideo; initial?: LearningState; signedIn: boolean; heading?: ReactNode;
}) {
  const learning = useLearning(video, initial, signedIn);
  const iframe = useRef<HTMLIFrameElement>(null);
  const player = useRef<Player | null>(null);
  const latest = useRef(learning);
  const [trackingUnavailable, setTrackingUnavailable] = useState(false);
  useEffect(() => { latest.current = learning; }, [learning]);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    let controller: Player | null = null;
    let ready = false;
    const element = iframe.current;
    const sample = (ended = false) => {
      if (!controller || !ready || typeof controller.getCurrentTime !== "function") return;
      const positionS = controller.getCurrentTime();
      if (!Number.isFinite(positionS) || (positionS <= 0 && !ended)) return;
      void latest.current.update({ action: "playback", positionS, observedAt: Date.now(), ended });
    };
    if (element) {
      const source = new URL(element.src);
      source.searchParams.set("origin", window.location.origin);
      element.src = source.toString();
      loadPlayerApi().then((api) => {
        if (cancelled) return;
        controller = new api.Player(element, {
          events: {
            onReady(event) {
              if (cancelled) return;
              ready = true;
              const state = latest.current.state;
              if (state.status !== "watched" && state.status !== "skipped" && state.positionS > 0) {
                event.target.cueVideoById({ videoId: video.videoId, startSeconds: state.positionS });
              }
              interval = window.setInterval(() => {
                if (controller?.getPlayerState() === 1) sample();
              }, 10_000);
            },
            onStateChange(event) {
              if (cancelled) return;
              if (event.data === 0) sample(true);
              else if (event.data === 2) sample();
            },
          },
        });
        player.current = controller;
      }).catch(() => { if (!cancelled) setTrackingUnavailable(true); });
    }
    const flush = () => sample();
    window.addEventListener("pagehide", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flush);
      if (interval) window.clearInterval(interval);
      sample();
      controller?.destroy();
      player.current = null;
    };
  }, [video.videoId]);

  const update: typeof learning.update = async (command) => {
    if (command.action === "status" && command.status === "in_progress") player.current?.seekTo?.(0, true);
    await learning.update(command);
  };
  return (
    <>
      <div className="player">
        <iframe ref={iframe}
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}?rel=0&enablejsapi=1&playsinline=1`}
          title={`YouTube video player: ${video.title}`}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
      </div>
      {heading}
      <div className="learning-tools">
        <LearningButtons state={learning.state} pending={learning.pending} update={update} />
        <p className="muted" role="status">
          {learning.state.status === "watched" ? "Marked watched." : learning.state.status === "skipped" ? "Skipped. You can undo it here." :
            learning.state.positionS > 0 ? `Resume point saved at ${Math.floor(learning.state.positionS / 60)}:${String(learning.state.positionS % 60).padStart(2, "0")}.` : ""}
          {!signedIn && <> Saved in this browser. <Link href="/signin">Sign in</Link> to keep account history across devices.</>}
        </p>
        {trackingUnavailable && <p className="muted">Automatic progress is unavailable. You can still use Mark watched.</p>}
        {learning.error && <p className="error" role="alert">{learning.error}</p>}
      </div>
    </>
  );
}
