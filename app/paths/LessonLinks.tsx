import { RESOURCE_KINDS, type LessonResource } from "@/lib/lesson-resources/model";
export function LessonLinks({ resources }: { resources: LessonResource[] }) {
  if (!resources.length) return null;
  return <div className="lesson-links" aria-label="Lesson resources">
    {resources.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer">
      <strong>{RESOURCE_KINDS[item.kind]}</strong> · {item.title} <span className="muted">({new URL(item.url).hostname}) ↗</span>
    </a>)}
  </div>;
}
