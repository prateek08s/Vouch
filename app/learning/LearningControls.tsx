"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserState, nextLearningState, subscribeLearning, writeBrowserState, type LearningCommand } from "@/lib/learning/browser";
import { EMPTY_LEARNING, type LearningState, type LearningVideo } from "@/lib/learning/model";

export function useLearning(video: LearningVideo, initial: LearningState, signedIn: boolean) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const current = useRef(initial);
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (signedIn) return;
    const read = () => {
      current.current = browserState(video.id);
      setState(current.current);
    };
    read();
    return subscribeLearning(read);
  }, [signedIn, video.id]);

  const update = useCallback((command: LearningCommand) => {
    const before = current.current;
    const next = nextLearningState(before, command, video.durationS);
    const requestRevision = ++revision.current;
    current.current = next;
    setState(next);
    setError("");
    if (!signedIn) {
      try { writeBrowserState(video, next); }
      catch {
        current.current = before;
        setState(before);
        setError("Your browser could not save this update. Check its storage settings and try again.");
      }
      return Promise.resolve();
    }
    if (command.action !== "playback") setPending(true);
    queue.current = queue.current.then(async () => {
      const response = await fetch("/api/learning", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, resourceId: video.id }), keepalive: true,
      });
      if (response.status === 409 && command.action === "playback") return;
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Your update could not be saved. Try again.");
      }
    }).catch((cause: unknown) => {
      if (revision.current === requestRevision) {
        current.current = before;
        setState(before);
      }
      setError(cause instanceof Error ? cause.message : "Your update could not be saved. Try again.");
    }).finally(() => {
      if (command.action !== "playback") setPending(false);
    });
    return queue.current;
  }, [signedIn, video]);
  return { state, error, pending, update };
}

export function LearningButtons({ state, pending, update }: {
  state: LearningState; pending: boolean; update: (command: LearningCommand) => Promise<void>;
}) {
  return (
    <div className="learning-buttons" aria-label="Save and track this video">
      <button type="button" className="button outline small" disabled={pending} aria-pressed={state.saved}
        onClick={() => void update({ action: "save", saved: !state.saved })}>
        {state.saved ? "Saved" : "Save for later"}
      </button>
      <button type="button" className="button quiet small" disabled={pending} aria-pressed={state.status === "watched"}
        onClick={() => void update({ action: "status", status: state.status === "watched" ? "in_progress" : "watched" })}>
        {state.status === "watched" ? "Mark unwatched" : "Mark watched"}
      </button>
      <button type="button" className="button quiet small" disabled={pending} aria-pressed={state.status === "skipped"}
        onClick={() => void update({ action: "status", status: state.status === "skipped" ? "in_progress" : "skipped" })}>
        {state.status === "skipped" ? "Undo skip" : "Skip"}
      </button>
    </div>
  );
}

export function LearningControls({ video, initial = EMPTY_LEARNING, signedIn, refreshOnChange = false }: {
  video: LearningVideo; initial?: LearningState; signedIn: boolean; refreshOnChange?: boolean;
}) {
  const learning = useLearning(video, initial, signedIn);
  const router = useRouter();
  const update = async (command: LearningCommand) => {
    await learning.update(command);
    if (refreshOnChange && signedIn) router.refresh();
  };
  return (
    <div>
      <LearningButtons state={learning.state} pending={learning.pending} update={update} />
      {learning.error && <p className="error" role="alert">{learning.error}</p>}
    </div>
  );
}
