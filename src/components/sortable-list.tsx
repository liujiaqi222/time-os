"use client";

import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  LoaderCircle,
} from "lucide-react";
import { useState, useTransition } from "react";

export function SortableList({
  label,
  items,
  onReorder,
}: {
  label: string;
  items: Array<{ id: string; label: string }>;
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const [ordered, setOrdered] = useState(items);
  const [dragged, setDragged] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function drop(targetId: string) {
    if (!dragged || dragged === targetId) return;
    const next = [...ordered];
    const from = next.findIndex((item) => item.id === dragged);
    const to = next.findIndex((item) => item.id === targetId);
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setOrdered(next);
    setDragged(null);
    startTransition(() => onReorder(next.map(({ id }) => id)));
  }

  function move(id: string, delta: -1 | 1) {
    const from = ordered.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    [next[from], next[to]] = [next[to]!, next[from]!];
    setOrdered(next);
    startTransition(() => onReorder(next.map((item) => item.id)));
  }

  if (items.length < 2) return null;
  return (
    <section
      aria-label={label}
      className="rounded-xl border border-stone-200 bg-white/60 p-3"
    >
      <div className="mb-2 flex items-center justify-between text-xs font-medium tracking-wide text-stone-500 uppercase">
        <span>{label}</span>
        {pending && (
          <LoaderCircle
            className="size-4 animate-spin"
            aria-label="正在保存顺序"
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ordered.map((item, index) => (
          <div
            key={item.id}
            className="inline-flex overflow-hidden rounded-lg border bg-white shadow-sm"
          >
            <button
              type="button"
              draggable
              onDragStart={() => setDragged(item.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => drop(item.id)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-sm"
            >
              <GripVertical
                className="size-3.5 text-stone-400"
                aria-hidden="true"
              />
              {item.label}
            </button>
            <button
              type="button"
              aria-label={`${item.label} 上移`}
              disabled={pending || index === 0}
              onClick={() => move(item.id, -1)}
              className="border-l px-1.5 text-stone-500 disabled:opacity-25"
            >
              <ArrowLeft className="size-3" />
            </button>
            <button
              type="button"
              aria-label={`${item.label} 下移`}
              disabled={pending || index === ordered.length - 1}
              onClick={() => move(item.id, 1)}
              className="border-l px-1.5 text-stone-500 disabled:opacity-25"
            >
              <ArrowRight className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
