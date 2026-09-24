"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="grid min-h-screen place-items-center px-5">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-3xl font-semibold">Time OS 暂时无法加载</h1>
            <p>请检查数据库连接后重试。如果刚部署，请确认数据库迁移已完成。</p>
            <button
              className="rounded-lg bg-black px-4 py-2 text-white"
              onClick={reset}
            >
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
