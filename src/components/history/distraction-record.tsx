"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveHistoryDistractionAction,
  updateHistoryDistractionAction,
} from "@/app/(app)/history/actions";
import type { Distraction } from "@/db/schema";
import { Button } from "@/components/ui/button";
export function DistractionRecord({ record }: { record: Distraction }) {
  const router = useRouter();
  const [text, setText] = useState(record.text ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  function save(archive = false) {
    setError(false);
    startTransition(async () => {
      try {
        const result = archive
          ? await archiveHistoryDistractionAction(record.id)
          : await updateHistoryDistractionAction(
              record.id,
              text.trim() || null,
            );
        if (!result.ok) {
          setError(true);
          return;
        }
        setEditing(false);
        router.refresh();
      } catch {
        setError(true);
      }
    });
  }
  return (
    <li className="rounded-xl bg-stone-50 p-3 text-sm">
      {editing ? (
        <label className="block">
          打断内容
          <textarea
            aria-label="打断内容"
            rows={2}
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-2 w-full rounded-lg border bg-white p-2"
          />
        </label>
      ) : (
        <p className="break-words whitespace-pre-wrap">
          {record.text || "未填写内容"}
          {record.archivedAt ? " · 已归档" : ""}
        </p>
      )}
      {!record.archivedAt && (
        <div className="mt-2 flex gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => save()}
              >
                保存
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                返回
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => save(true)}
              >
                归档
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-amber-900">
          保存失败，输入仍保留，可重试。
        </p>
      )}
    </li>
  );
}
