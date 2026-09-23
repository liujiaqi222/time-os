"use client";

import { useCallback, useState } from "react";

import type { Distraction } from "@/services/distraction";
import type {
  DistractionCreateInput,
  DistractionUpdateInput,
} from "@/shared/schemas/session";
import type { Result } from "@/shared/result";

export interface DistractionActions {
  create: (input: DistractionCreateInput) => Promise<Result<Distraction>>;
  update: (
    id: string,
    input: DistractionUpdateInput,
  ) => Promise<Result<Distraction>>;
  archive: (id: string) => Promise<Result<Distraction>>;
}

/**
 * Distraction log state for the focus page: list plus create/archive/update
 * handlers and the inline-edit state. Actions are injected, so tests can
 * drive the hook without the network.
 */
export function useDistractions(options: {
  initial: Distraction[];
  actions: DistractionActions;
}) {
  const { actions } = options;
  const [list, setList] = useState(options.initial);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const create = useCallback(
    async (input: DistractionCreateInput): Promise<boolean> => {
      setError(null);
      const result = await actions.create(input);
      if (result.ok) {
        setList((prev) => [...prev, result.data]);
        return true;
      }
      setError(result.error.message);
      return false;
    },
    [actions],
  );

  const archive = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      const result = await actions.archive(id);
      if (result.ok) {
        setList((prev) => prev.filter((d) => d.id !== id));
      } else {
        setError(result.error.message);
      }
    },
    [actions],
  );

  const saveEdit = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      const result = await actions.update(id, {
        text: editingText.trim() || null,
      });
      if (result.ok) {
        setList((prev) => prev.map((d) => (d.id === id ? result.data : d)));
        setEditingId(null);
      } else {
        setError(result.error.message);
      }
    },
    [actions, editingText],
  );

  const beginEdit = useCallback((distraction: Distraction) => {
    setEditingId(distraction.id);
    setEditingText(distraction.text ?? "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  return {
    list,
    error,
    editingId,
    editingText,
    setEditingText,
    create,
    archive,
    saveEdit,
    beginEdit,
    cancelEdit,
  };
}
