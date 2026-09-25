import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="space-y-4 text-center">
        <p className="font-mono text-sm text-stone-500">404</p>
        <h1 className="text-3xl font-semibold">这里没有下一步</h1>
        <Button nativeButton={false} render={<Link href="/today" />}>
          返回今天
        </Button>
      </div>
    </main>
  );
}
