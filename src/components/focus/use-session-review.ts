"use client";

import { useCallback, useState } from "react";

import type { SessionReviewResult } from "@/services/session";
import type { SessionReviewInput } from "@/shared/schemas/session";
import type { Result } from "@/shared/result";

/**
 * Finish-review submission for the focus page. The submit action is
 * injected, so tests can drive the hook without the network.
 */
export function useSessionReview(options: {
  submit: (input: SessionReviewInput) => Promise<Result<SessionReviewResult>>;
  onSubmitted: () => void;
}) {
  const { submit, onSubmitted } = options;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = useCallback(
    async (input: SessionReviewInput) => {
      setSubmitting(true);
      setError(null);

      const result = await submit(input);

      setSubmitting(false);

      if (result.ok) {
        onSubmitted();
      } else {
        setError(`${result.error.code}: ${result.error.message}`);
      }
    },
    [submit, onSubmitted],
  );

  return { submitting, error, review };
}
