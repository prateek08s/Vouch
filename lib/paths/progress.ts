import type { LearningStatus } from "@/lib/learning/model";
export type PathLesson = { resource_id: string; title: string; metadata_status: string; status: LearningStatus | null };
export function pathProgress(lessons: PathLesson[]) {
  const available = lessons.filter((lesson) => lesson.metadata_status !== "unavailable");
  const watched = available.filter((lesson) => lesson.status === "watched").length;
  const skipped = available.filter((lesson) => lesson.status === "skipped").length;
  return {
    total: available.length, watched, skipped, unavailable: lessons.length - available.length,
    percent: available.length ? Math.round(watched / available.length * 100) : 0,
    completed: available.length > 0 && watched === available.length,
    next: available.find((lesson) => lesson.status !== "watched" && lesson.status !== "skipped") ?? null,
    review: available.find((lesson) => lesson.status === "skipped") ?? null,
  };
}
