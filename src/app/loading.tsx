import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main
      className="mx-auto w-full max-w-6xl space-y-6 px-5 py-10"
      aria-busy="true"
    >
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-72 w-full" />
    </main>
  );
}
