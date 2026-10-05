import { ui, type ReviewTarget } from "../bridge.ts";

// Opening the crew's work for review, from anywhere in the interface (or the game, through the bridge's `review`).
// At the helm it opens as the third column; elsewhere the phone unfolds onto it (Overlay watches `review`).

export function openReview(target: ReviewTarget) {
  ui.set({ review: { threadId: target.threadId, taskId: target.taskId }, threadId: target.threadId, crewCard: null });
}

export const closeReview = () => ui.set({ review: null });
