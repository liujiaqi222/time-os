"use client";

import { Button } from "@/components/ui/button";

export function ConfirmSubmit({ children }: { children: React.ReactNode }) {
  return (
    <Button
      type="submit"
      size="xs"
      variant="destructive"
      onClick={(event) => {
        if (!window.confirm("确认执行这个状态操作？数据不会被删除。"))
          event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
