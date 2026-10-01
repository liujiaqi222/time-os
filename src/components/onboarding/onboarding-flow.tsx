"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  checkOnboardingGoalsAction,
  createOnboardingGoalAction,
  type OnboardingCandidate,
  selectOnboardingGoalAction,
} from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type OnboardingDraft,
  type OnboardingStep,
  onboardingDraftStorageKey,
  parseOnboardingDraft,
} from "@/shared/onboarding";

const examples = ["把产品介绍页做完", "开始稳定写作", "准备下一次职业选择"];
const subscribeToHydration = () => () => undefined;

function emptyDraft(): OnboardingDraft {
  return {
    version: 1,
    step: "goal",
    title: "",
    description: "",
    idempotencyKey: `onboarding-${crypto.randomUUID()}`,
  };
}

export function OnboardingFlow({ endpoint }: { endpoint: string }) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  if (!hydrated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f1ea]">
        <Loader2
          className="size-5 animate-spin text-stone-400"
          aria-label="正在恢复引导"
        />
      </main>
    );
  }

  return <HydratedOnboardingFlow endpoint={endpoint} />;
}

function HydratedOnboardingFlow({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const storageKey = onboardingDraftStorageKey(window.location.origin);
  const [draft, setDraft] = useState<OnboardingDraft>(() => {
    return (
      parseOnboardingDraft(localStorage.getItem(storageKey)) ?? emptyDraft()
    );
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [checkMessage, setCheckMessage] = useState<string>();
  const [candidates, setCandidates] = useState<OnboardingCandidate[]>([]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);

  const setStep = (step: OnboardingStep) => {
    setError(undefined);
    setDraft((current) => ({ ...current, step }));
  };

  const complete = () => {
    localStorage.removeItem(storageKey);
    router.push("/today?first=1");
    router.refresh();
  };

  const saveManualGoal = async () => {
    const title = draft.title.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(undefined);
    const result = await createOnboardingGoalAction({
      title,
      description: draft.description.trim() || null,
      idempotencyKey: draft.idempotencyKey,
    });
    if (result.ok) complete();
    else {
      setError(result.error.message);
      setBusy(false);
    }
  };

  const checkGoals = async () => {
    setBusy(true);
    setError(undefined);
    setCheckMessage(undefined);
    const result = await checkOnboardingGoalsAction();
    if (!result.ok) {
      setError(result.error.message);
    } else if (result.data.length === 0) {
      setCandidates([]);
      setCheckMessage(
        "连接可能已经成功，但 Time OS 里还没有目标。请在 ChatGPT 中确认写入后再检查。",
      );
    } else {
      setCandidates(result.data);
      setCheckMessage(
        result.data.length === 1
          ? "找到了一个已保存目标。确认后会使用它，不会再创建副本。"
          : "找到了多个目标，请选择这次要开始的一个。",
      );
    }
    setBusy(false);
  };

  const chooseGoal = async (goalId: string) => {
    setBusy(true);
    setError(undefined);
    const result = await selectOnboardingGoalAction(goalId);
    if (result.ok) complete();
    else {
      setError(result.error.message);
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-5 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <span className="grid size-8 place-items-center rounded-xl bg-stone-950 text-white">
              <Target className="size-4" aria-hidden="true" />
            </span>
            Time OS
          </div>
          <span className="font-mono text-xs tracking-[0.16em] text-stone-400 uppercase">
            {draft.step === "goal"
              ? "第一幕"
              : draft.step === "reason"
                ? "第二幕"
                : "AI 路径"}
          </span>
        </header>

        <section className="mt-10 rounded-[2rem] border border-stone-200 bg-white px-5 py-8 shadow-[0_18px_50px_rgba(28,25,23,0.07)] sm:mt-14 sm:px-10 sm:py-12">
          {draft.step === "goal" && (
            <GoalStep
              title={draft.title}
              onTitleChange={(title) => setDraft({ ...draft, title })}
              onContinue={() => setStep("reason")}
              onAi={() => setStep("ai")}
            />
          )}
          {draft.step === "reason" && (
            <ReasonStep
              draft={draft}
              busy={busy}
              error={error}
              onChange={(description) => setDraft({ ...draft, description })}
              onBack={() => setStep("goal")}
              onSave={() => void saveManualGoal()}
            />
          )}
          {draft.step === "ai" && (
            <AiStep
              endpoint={endpoint}
              busy={busy}
              error={error}
              message={checkMessage}
              candidates={candidates}
              onBack={() => setStep("goal")}
              onCheck={() => void checkGoals()}
              onChoose={(goalId) => void chooseGoal(goalId)}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function GoalStep({
  title,
  onTitleChange,
  onContinue,
  onAi,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  onContinue: () => void;
  onAi: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl text-center">
      <p className="text-sm font-medium text-[#b54b35]">
        先确定一件真正想推进的事
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-balance text-stone-950 sm:text-5xl sm:leading-tight">
        最近，有什么事是你真的想推进的？
      </h1>
      <p className="mx-auto mt-4 max-w-md leading-7 text-stone-500">
        不需要先拆计划，也不用填写期限。一个清楚的标题就够了。
      </p>
      <form
        className="mt-9"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onContinue();
        }}
      >
        <Input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          maxLength={240}
          autoFocus
          aria-label="目标标题"
          placeholder="我想推进…"
          className="h-14 rounded-2xl border-stone-300 bg-stone-50 px-5 text-center text-lg shadow-none focus-visible:bg-white"
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {examples.map((example) => (
            <button
              type="button"
              key={example}
              onClick={() => onTitleChange(example)}
              className="rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-500 hover:border-stone-300 hover:text-stone-800"
            >
              {example}
            </button>
          ))}
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={!title.trim()}
          className="mt-8 h-12 rounded-full px-7"
        >
          继续
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <button
        type="button"
        onClick={onAi}
        className="mt-7 inline-flex items-center gap-2 text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
      >
        <Bot className="size-4" aria-hidden="true" />
        我想先和 ChatGPT 聊清楚
      </button>
    </div>
  );
}

function ReasonStep({
  draft,
  busy,
  error,
  onChange,
  onBack,
  onSave,
}: {
  draft: OnboardingDraft;
  busy: boolean;
  error?: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm font-medium text-[#b54b35]">让它对你更有意义</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-stone-950 sm:text-4xl">
        如果做成，你最期待的变化是什么？
      </h1>
      <p className="mt-3 leading-7 text-stone-500">
        可选。它会成为目标说明，不影响你马上开始。
      </p>

      <div className="mt-7 rounded-2xl border border-[#eaded7] bg-[#fdf7f3] p-5">
        <p className="text-xs font-semibold tracking-[0.16em] text-[#b54b35] uppercase">
          目标正在成形
        </p>
        <p className="mt-2 text-xl font-semibold text-stone-950">
          {draft.title.trim()}
        </p>
      </div>

      <label
        htmlFor="goal-reason"
        className="mt-7 block text-sm font-medium text-stone-700"
      >
        我最期待的是
      </label>
      <textarea
        id="goal-reason"
        value={draft.description}
        onChange={(event) => onChange(event.target.value)}
        maxLength={10_000}
        rows={4}
        placeholder="例如：每天打开电脑时，知道下一步该做什么。"
        className="mt-2 w-full resize-none rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-base leading-7 outline-none focus:border-stone-500 focus:bg-white"
      />

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回修改
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={onSave}
          disabled={busy}
          className="rounded-full px-6"
        >
          {busy
            ? "正在保存…"
            : draft.description.trim()
              ? "保存目标，准备开始"
              : "跳过并保存目标"}
          {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function AiStep({
  endpoint,
  busy,
  error,
  message,
  candidates,
  onBack,
  onCheck,
  onChoose,
}: {
  endpoint: string;
  busy: boolean;
  error?: string;
  message?: string;
  candidates: OnboardingCandidate[];
  onBack: () => void;
  onCheck: () => void;
  onChoose: (goalId: string) => void;
}) {
  const prompt = `请和我一起讨论一个真正想推进的目标。先帮我把目标和第一个可执行步骤聊清楚，不要一次生成很多任务。只有在我明确确认后，才调用 Time OS 的 goal_create；如果需要再调用 tasks_create，最后用 selection_set 选中它。`;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-stone-950 text-white">
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-[#b54b35]">ChatGPT MCP App</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-stone-950 sm:text-4xl">
            先聊清楚，再写回目标
          </h1>
        </div>
      </div>
      <p className="mt-5 leading-7 text-stone-600">
        ChatGPT
        会通过安全授权访问这个实例。连接成功不等于目标已经保存；最后仍要回到这里检查真实数据。
      </p>

      <ol className="mt-7 space-y-4">
        <AiInstruction number="1" title="在 ChatGPT 中创建 MCP App">
          <p>
            打开 Plugin 管理页，点击 Add → Create MCP App，再填写下面的地址。
          </p>
          <a
            href="https://chatgpt.com/plugins"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
          >
            打开 ChatGPT Plugins
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          <CopyValue value={endpoint} label="复制 MCP 地址" />
        </AiInstruction>
        <AiInstruction number="2" title="从一段克制的对话开始">
          <CopyValue value={prompt} label="复制开场话术" multiline />
        </AiInstruction>
        <AiInstruction number="3" title="确认写入后，回到这里检查">
          <p>只有 Time OS 读到了已保存的 Goal，才算完成。</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={onCheck}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            {busy ? "正在检查…" : "检查已保存目标"}
          </Button>
        </AiInstruction>
      </ol>

      {(message || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-5 rounded-xl p-4 text-sm leading-6 ${error ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900"}`}
        >
          {error ?? message}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-5 grid gap-3">
          {candidates.map((candidate) => (
            <div
              key={candidate.goal.id}
              className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
            >
              <div>
                <p className="font-semibold text-stone-950">
                  {candidate.goal.title}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {candidate.pendingTaskCount > 0
                    ? `${candidate.pendingTaskCount} 个待办任务${candidate.firstTask ? ` · 下一步：${candidate.firstTask.title}` : ""}`
                    : "还没有任务，可以直接围绕目标开始"}
                </p>
              </div>
              <Button
                type="button"
                className="mt-3 shrink-0 sm:mt-0"
                disabled={busy}
                onClick={() => onChoose(candidate.goal.id)}
              >
                用这个目标开始
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        className="mt-7"
        onClick={onBack}
        disabled={busy}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        改为手动创建
      </Button>
    </div>
  );
}

function AiInstruction({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-2xl border border-stone-200 p-4 sm:p-5">
      <div className="flex gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-stone-100 font-mono text-xs text-stone-600">
          {number}
        </span>
        <div className="min-w-0 flex-1 text-sm leading-6 text-stone-600">
          <h2 className="font-semibold text-stone-900">{title}</h2>
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </li>
  );
}

function CopyValue({
  value,
  label,
  multiline = false,
}: {
  value: string;
  label: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl bg-stone-950 p-3 text-stone-100">
      <code
        className={`min-w-0 flex-1 font-mono text-xs leading-5 break-all whitespace-pre-wrap ${multiline ? "max-h-32 overflow-y-auto" : ""}`}
      >
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void copy()}
        aria-label={label}
        className="shrink-0 text-stone-300 hover:bg-white/10 hover:text-white"
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Clipboard className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
