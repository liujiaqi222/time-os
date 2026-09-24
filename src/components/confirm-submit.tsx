"use client";

import { useId, useState } from "react";

import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmSubmit({
  children,
  title,
  description,
  confirmLabel,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      {open && (
        <ConfirmationDialog
          titleId={titleId}
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          confirmType="submit"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
