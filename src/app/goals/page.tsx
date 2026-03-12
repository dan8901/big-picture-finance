"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  YAxis,
} from "recharts";

const CATEGORIES = [
  "Food & Groceries",
  "Restaurants & Cafes",
  "Transportation",
  "Housing & Utilities",
  "Health & Medical",
  "Shopping & Clothing",
  "Entertainment & Leisure",
  "Subscriptions",
  "Insurance",
  "Education",
  "Transfers",
  "Government & Taxes",
  "Other",
];

type GoalData = {
  id: number;
  name: string;
  type: "budget_cap" | "savings_target" | "savings_amount";
  scope: "overall" | "category";
  category: string | null;
  owner: string | null;
  targetAmount: number;
  currency: string;
  period: "monthly" | "annual";
  isActive: number;
  currentAmount: number;
  currentPeriod: string;
  progress: number;
  status: "on_track" | "at_risk" | "exceeded" | "achieved";
  streak: number;
  history: { period: string; achieved: boolean; actualAmount: number }[];
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const fmtCurrency = (n: number, currency = "USD") =>
  (currency === "ILS" ? "\u20AA" : "$") + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function statusColor(status: string) {
  switch (status) {
    case "on_track":
    case "achieved":
      return "text-green-500";
    case "at_risk":
      return "text-yellow-500";
    case "exceeded":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}

function statusBg(status: string) {
  switch (status) {
    case "on_track":
    case "achieved":
      return "bg-green-500";
    case "at_risk":
      return "bg-yellow-500";
    case "exceeded":
      return "bg-red-500";
    default:
      return "bg-muted";
  }
}

function statusLabel(goal: GoalData) {
  if (goal.type === "budget_cap") {
    switch (goal.status) {
      case "on_track":
        return "On Track";
      case "at_risk":
        return "At Risk";
      case "exceeded":
        return "Over Budget";
      default:
        return goal.status;
    }
  } else {
    switch (goal.status) {
      case "achieved":
        return "Achieved";
      case "on_track":
        return "On Track";
      case "at_risk":
        return "At Risk";
      case "exceeded":
        return "Below Target";
      default:
        return goal.status;
    }
  }
}

function getGrade(goalsData: GoalData[]) {
  const active = goalsData.filter((g) => g.isActive);
  if (active.length === 0) return "-";
  const achieved = active.filter(
    (g) => g.status === "on_track" || g.status === "achieved"
  ).length;
  const pct = achieved / active.length;
  if (pct >= 0.9) return "A";
  if (pct >= 0.75) return "B";
  if (pct >= 0.5) return "C";
  return "D";
}

function gradeColor(grade: string) {
  switch (grade) {
    case "A":
      return "text-green-500";
    case "B":
      return "text-blue-500";
    case "C":
      return "text-yellow-500";
    case "D":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}

function CircularProgress({
  progress,
  status,
  size = 80,
}: {
  progress: number;
  status: string;
  size?: number;
}) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(progress, 0), 100);
  const offset = circumference - (clamped / 100) * circumference;

  const color =
    status === "on_track" || status === "achieved"
      ? "#22c55e"
      : status === "at_risk"
        ? "#eab308"
        : "#ef4444";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/20"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
        {fmt(Math.round(clamped))}%
      </div>
    </div>
  );
}

function Sparkline({ history }: { history: GoalData["history"] }) {
  if (history.length === 0) return null;
  const data = [...history].reverse().map((h) => ({
    period: h.period,
    value: h.actualAmount,
    achieved: h.achieved,
  }));

  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#6366f1"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function GoalCard({
  goal,
  onDelete,
  onToggle,
  onEdit,
}: {
  goal: GoalData;
  onDelete: (id: number) => void;
  onToggle: (id: number, active: boolean) => void;
  onEdit: (goal: GoalData) => void;
}) {
  const isBudget = goal.type === "budget_cap";
  const showsAmount = goal.type !== "savings_target"; // budget_cap and savings_amount show currency
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-opacity ${goal.isActive ? "" : "opacity-50"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium truncate">{goal.name}</h3>
          <p className="text-xs text-muted-foreground">
            {goal.type === "budget_cap" ? "Budget Cap" : goal.type === "savings_amount" ? "Savings Goal" : "Savings %"} /{" "}
            {goal.period === "monthly" ? "mo" : "yr"}
            {goal.owner && ` / ${goal.owner}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {goal.streak > 0 && (
            <span className="text-xs bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded-full font-medium">
              {goal.streak}
            </span>
          )}
          <button
            onClick={() => onEdit(goal)}
            className="text-xs text-muted-foreground hover:text-foreground p-1"
            title="Edit"
          >
            edit
          </button>
          <button
            onClick={() => onToggle(goal.id, goal.isActive === 0)}
            className="text-xs text-muted-foreground hover:text-foreground p-1"
            title={goal.isActive ? "Deactivate" : "Activate"}
          >
            {goal.isActive ? "ON" : "OFF"}
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Sure?</span>
              <button
                onClick={() => { onDelete(goal.id); setConfirmingDelete(false); }}
                className="text-red-500 hover:text-red-600 font-medium p-1"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-xs text-muted-foreground hover:text-red-500 p-1"
              title="Delete"
            >
              x
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <CircularProgress progress={goal.progress} status={goal.status} />
        <div className="space-y-1 min-w-0">
          <div className="text-lg font-semibold">
            {showsAmount
              ? fmtCurrency(goal.currentAmount, goal.currency)
              : `${fmt(goal.currentAmount)}%`}
            <span className="text-sm font-normal text-muted-foreground">
              {" / "}
              {showsAmount
                ? fmtCurrency(goal.targetAmount, goal.currency)
                : `${fmt(goal.targetAmount)}%`}
            </span>
          </div>
          <div className={`text-xs font-medium ${statusColor(goal.status)}`}>
            {statusLabel(goal)}
          </div>
          <div className="w-full bg-muted/30 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${statusBg(goal.status)}`}
              style={{ width: `${Math.min(goal.progress, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Sparkline history={goal.history} />
        {goal.history.length > 0 && (
          <div className="flex gap-0.5">
            {[...goal.history].reverse().map((h) => (
              <div
                key={h.period}
                className={`w-3 h-3 rounded-sm ${h.achieved ? "bg-green-500" : "bg-red-400"}`}
                title={`${h.period}: ${h.achieved ? "Achieved" : "Missed"}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateGoalDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"budget_cap" | "savings_target" | "savings_amount">(
    "budget_cap"
  );
  const [scope, setScope] = useState<"overall" | "category">("overall");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [owner, setOwner] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          scope,
          category: scope === "category" ? category : null,
          owner: owner || null,
          targetAmount: parseFloat(targetAmount),
          currency,
          period,
        }),
      });
      if (!res.ok) throw new Error("Failed to create goal");
      toast.success("Goal created");
      onCreated();
      onClose();
      setName("");
      setTargetAmount("");
    } catch {
      toast.error("Failed to create goal");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Create Goal</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Food budget"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Type</label>
              <select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as "budget_cap" | "savings_target" | "savings_amount")
                }
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="budget_cap">Budget Cap</option>
                <option value="savings_amount">Savings Goal ($)</option>
                <option value="savings_target">Savings Rate (%)</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Period</label>
              <select
                value={period}
                onChange={(e) =>
                  setPeriod(e.target.value as "monthly" | "annual")
                }
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Scope</label>
              <select
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as "overall" | "category")
                }
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="overall">Overall</option>
                <option value="category">Category</option>
              </select>
            </div>
            {scope === "category" && (
              <div>
                <label className="text-sm font-medium">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">
                Target {type === "savings_target" ? "(%)" : "Amount"}
              </label>
              <input
                type="number"
                step="any"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                required
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={type === "savings_target" ? "40" : "500"}
              />
            </div>
            {type !== "savings_target" && (
              <div>
                <label className="text-sm font-medium">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="ILS">ILS</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">
              Owner{" "}
              <span className="text-muted-foreground font-normal">
                (blank = household)
              </span>
            </label>
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Daniel"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditGoalDialog({
  goal,
  onClose,
  onUpdated,
}: {
  goal: GoalData | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (goal) {
      setName(goal.name);
      setTargetAmount(String(goal.targetAmount));
      setCurrency(goal.currency);
      setOwner(goal.owner ?? "");
    }
  }, [goal]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal) return;
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: goal.id,
          name,
          targetAmount: parseFloat(targetAmount),
          currency,
          owner: owner || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update goal");
      toast.success("Goal updated");
      onUpdated();
      onClose();
    } catch {
      toast.error("Failed to update goal");
    } finally {
      setSaving(false);
    }
  }

  if (!goal) return null;

  const isPercentage = goal.type === "savings_target";
  const typeLabel = goal.type === "budget_cap" ? "Budget Cap" : goal.type === "savings_amount" ? "Savings Goal" : "Savings Rate";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Edit Goal</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className={isPercentage ? "" : "grid grid-cols-2 gap-3"}>
            <div>
              <label className="text-sm font-medium">
                Target {isPercentage ? "(%)" : "Amount"}
              </label>
              <input
                type="number"
                step="any"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                required
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            {!isPercentage && (
              <div>
                <label className="text-sm font-medium">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="ILS">ILS</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">
              Owner{" "}
              <span className="text-muted-foreground font-normal">
                (blank = household)
              </span>
            </label>
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Type: {typeLabel} / {goal.period}
            {goal.scope === "category" && ` / ${goal.category}`}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const [goalsData, setGoalsData] = useState<GoalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalData | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch("/api/goals");
      const data = await res.json();
      setGoalsData(data);
    } catch {
      toast.error("Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  async function handleDelete(id: number) {
    await fetch(`/api/goals?id=${id}`, { method: "DELETE" });
    toast.success("Goal deleted");
    fetchGoals();
  }

  async function handleToggle(id: number, active: boolean) {
    await fetch("/api/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive: active ? 1 : 0 }),
    });
    fetchGoals();
  }

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      // Generate last 6 months as periods
      const periods: string[] = [];
      const now = new Date();
      for (let i = 1; i <= 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        periods.push(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        );
      }

      const res = await fetch("/api/goals/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periods }),
      });
      const { results } = await res.json();

      const newAchievements = results.filter(
        (r: { achieved: boolean }) => r.achieved
      ).length;

      if (newAchievements > 0) {
        toast.success(
          `${newAchievements} goal${newAchievements > 1 ? "s" : ""} achieved!`
        );
        // Fire confetti
        try {
          const confetti = (await import("canvas-confetti")).default;
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
          });

          // Check for streak milestones
          const hasStreakMilestone = results.some(
            (r: { achieved: boolean; goalId: number }) => {
              if (!r.achieved) return false;
              const goal = goalsData.find((g) => g.id === r.goalId);
              const newStreak = (goal?.streak ?? 0) + 1;
              return [3, 6, 12].includes(newStreak);
            }
          );
          if (hasStreakMilestone) {
            setTimeout(() => {
              confetti({
                particleCount: 200,
                spread: 100,
                origin: { y: 0.5 },
              });
              toast.success("Streak milestone reached!");
            }, 800);
          }
        } catch {
          // confetti import failed, no big deal
        }
      } else {
        toast("Evaluation complete — no new achievements this time");
      }

      fetchGoals();
    } catch {
      toast.error("Failed to evaluate goals");
    } finally {
      setEvaluating(false);
    }
  }

  const activeGoals = goalsData.filter((g) => g.isActive);
  const inactiveGoals = goalsData.filter((g) => !g.isActive);
  const totalBadges = goalsData.reduce(
    (sum, g) => sum + g.history.filter((h) => h.achieved).length,
    0
  );
  const longestStreak = Math.max(0, ...goalsData.map((g) => g.streak));
  const grade = getGrade(goalsData);

  // Owner leaderboard
  const ownerStreaks: Record<string, number> = {};
  for (const g of goalsData) {
    const key = g.owner || "Household";
    ownerStreaks[key] = (ownerStreaks[key] ?? 0) + g.streak;
  }
  const leaderboard = Object.entries(ownerStreaks).sort(
    ([, a], [, b]) => b - a
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">Goals</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 rounded-lg border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Goals</h1>
        <div className="flex gap-2">
          <button
            onClick={handleEvaluate}
            disabled={evaluating || activeGoals.length === 0}
            className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent disabled:opacity-50"
          >
            {evaluating ? "Evaluating..." : "Evaluate Past Months"}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            + New Goal
          </button>
        </div>
      </div>

      {/* Summary Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold">{longestStreak}</div>
          <div className="text-xs text-muted-foreground">Best Streak</div>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold">{totalBadges}</div>
          <div className="text-xs text-muted-foreground">Badges Earned</div>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <div className={`text-2xl font-bold ${gradeColor(grade)}`}>
            {grade}
          </div>
          <div className="text-xs text-muted-foreground">Report Card</div>
        </div>
        <div className="rounded-lg border p-4 text-center">
          {leaderboard.length > 0 ? (
            <div className="space-y-0.5">
              {leaderboard.map(([owner, streaks], i) => (
                <div key={owner} className="text-xs flex justify-between">
                  <span>
                    {i === 0 ? "\uD83D\uDC51 " : ""}
                    {owner}
                  </span>
                  <span className="font-medium">{streaks}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No goals yet</div>
          )}
          <div className="text-xs text-muted-foreground mt-1">Leaderboard</div>
        </div>
      </div>

      {/* Active Goals Grid */}
      {activeGoals.length === 0 && inactiveGoals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">No goals yet</p>
          <p className="text-sm mt-1">
            Create your first goal to start tracking progress
          </p>
        </div>
      ) : (
        <>
          {activeGoals.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Active Goals</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onDelete={handleDelete}
                    onToggle={handleToggle}
                    onEdit={setEditingGoal}
                  />
                ))}
              </div>
            </div>
          )}

          {inactiveGoals.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Inactive Goals</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inactiveGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onDelete={handleDelete}
                    onToggle={handleToggle}
                    onEdit={setEditingGoal}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Achievement History */}
      {goalsData.some((g) => g.history.length > 0) && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Achievement History</h2>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 font-medium">Goal</th>
                  {goalsData[0]?.history
                    ?.slice()
                    .reverse()
                    .map((h) => (
                      <th
                        key={h.period}
                        className="text-center p-3 font-medium"
                      >
                        {h.period}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {goalsData
                  .filter((g) => g.history.length > 0)
                  .map((g) => (
                    <tr key={g.id} className="border-b last:border-0">
                      <td className="p-3 font-medium">{g.name}</td>
                      {[...g.history].reverse().map((h) => (
                        <td key={h.period} className="text-center p-3">
                          <span
                            title={`${h.actualAmount}`}
                            className={
                              h.achieved ? "text-green-500" : "text-red-400"
                            }
                          >
                            {h.achieved ? "\u2713" : "\u2717"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateGoalDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchGoals}
      />
      <EditGoalDialog
        goal={editingGoal}
        onClose={() => setEditingGoal(null)}
        onUpdated={fetchGoals}
      />
    </div>
  );
}
