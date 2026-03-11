"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface IncomeEntry {
  id: number;
  source: string;
  label: string | null;
  monthlyAmount: string;
  currency: string;
  startDate: string;
  owner: string;
}

const INCOME_SOURCES = [
  { value: "salary", label: "Salary" },
  { value: "rsu", label: "RSUs" },
  { value: "espp", label: "ESPP" },
  { value: "pension", label: "Pension" },
  { value: "keren_hishtalmut", label: "Keren Hishtalmut" },
  { value: "other", label: "Other" },
];

const CURRENCIES = [
  { value: "USD", label: "USD ($)" },
  { value: "ILS", label: "ILS (\u20AA)" },
];

function formatCurrency(amount: string, currency: string) {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatMonth(yyyymm: string) {
  const [year, month] = yyyymm.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function IncomePage() {
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    source: "",
    label: "",
    monthlyAmount: "",
    currency: "",
    startDate: getCurrentYearMonth(),
    owner: "",
  });

  const fetchEntries = useCallback(async () => {
    const res = await fetch("/api/income");
    const data = await res.json();
    setEntries(data);
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      await fetch("/api/income", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...form }),
      });
    } else {
      await fetch("/api/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    resetForm();
    setDialogOpen(false);
    fetchEntries();
  }

  function resetForm() {
    setEditingId(null);
    setForm({
      source: "",
      label: "",
      monthlyAmount: "",
      currency: "",
      startDate: getCurrentYearMonth(),
      owner: "",
    });
  }

  function handleEdit(entry: IncomeEntry) {
    setEditingId(entry.id);
    setForm({
      source: entry.source,
      label: entry.label ?? "",
      monthlyAmount: entry.monthlyAmount,
      currency: entry.currency,
      startDate: entry.startDate,
      owner: entry.owner,
    });
    setDialogOpen(true);
  }

  async function handleDelete(id: number) {
    await fetch(`/api/income?id=${id}`, { method: "DELETE" });
    fetchEntries();
  }

  const sourceLabel = (value: string) =>
    INCOME_SOURCES.find((s) => s.value === value)?.label ?? value;

  // Group entries by source+owner for display
  const grouped = entries.reduce(
    (acc, entry) => {
      const key = `${entry.source}-${entry.owner}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    },
    {} as Record<string, IncomeEntry[]>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Manual Income</h2>
          <p className="text-muted-foreground">
            Enter income from RSUs, ESPP, pension, keren hishtalmut, and other
            sources. Add multiple entries per source to reflect raises.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button onClick={() => resetForm()}>Add Income Entry</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Income Entry" : "Add Income Entry"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Source</Label>
                <Select
                  value={form.source}
                  onValueChange={(v) => setForm({ ...form, source: v })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCOME_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Label (optional)</Label>
                <Input
                  id="label"
                  placeholder="e.g. NVIDIA RSU, Company bonus"
                  value={form.label}
                  onChange={(e) =>
                    setForm({ ...form, label: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthlyAmount">Monthly Amount</Label>
                <Input
                  id="monthlyAmount"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 5000"
                  value={form.monthlyAmount}
                  onChange={(e) =>
                    setForm({ ...form, monthlyAmount: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => setForm({ ...form, currency: v })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startDate">Effective From</Label>
                <Input
                  id="startDate"
                  type="month"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">
                  This amount applies from this month onward (until the next
                  entry for the same source).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="owner">Owner</Label>
                <Input
                  id="owner"
                  placeholder="e.g. Daniel, Sarah"
                  value={form.owner}
                  onChange={(e) =>
                    setForm({ ...form, owner: e.target.value })
                  }
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {editingId ? "Save Changes" : "Add Entry"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex h-[300px] items-center justify-center text-muted-foreground">
            No income entries yet. Add your first income source to get started.
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([key, groupEntries]) => {
          const first = groupEntries[0];
          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {sourceLabel(first.source)}
                  {first.label && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {first.label}
                    </span>
                  )}
                  <Badge variant="outline">{first.owner}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Monthly Amount</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{formatMonth(entry.startDate)}</TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(entry.monthlyAmount, entry.currency)}
                          /mo
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(entry)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(entry.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
