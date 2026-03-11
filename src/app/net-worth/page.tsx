"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

interface Account {
  id: number;
  name: string;
  type: string;
  institution: string;
  currency: string;
  owner: string;
}

interface Snapshot {
  id: number;
  accountId: number;
  balance: string;
  currency: string;
  snapshotDate: string;
  accountName: string;
  accountType: string;
  accountOwner: string;
}

interface BalanceEntry {
  accountId: number;
  balance: string;
  currency: string;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function NetWorthPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [snapshotDate, setSnapshotDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [balances, setBalances] = useState<BalanceEntry[]>([]);
  const [ilsToUsd, setIlsToUsd] = useState(0);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    setAccounts(await res.json());
  }, []);

  const fetchSnapshots = useCallback(async () => {
    const res = await fetch("/api/net-worth");
    setSnapshots(await res.json());
  }, []);

  const fetchLatestRate = useCallback(async () => {
    const res = await fetch("/api/exchange-rates");
    const data = await res.json();
    if (data.latestRate) setIlsToUsd(data.latestRate);
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchSnapshots();
    fetchLatestRate();
  }, [fetchAccounts, fetchSnapshots, fetchLatestRate]);

  function startRecording() {
    setIsRecording(true);
    setCurrentStep(0);
    // Pre-populate with last known balances (skip credit cards)
    const nonCC = accounts.filter((a) => a.type !== "credit_card");
    const lastBalances = nonCC.map((account) => {
      const lastSnapshot = snapshots.find(
        (s) => s.accountId === account.id
      );
      return {
        accountId: account.id,
        balance: lastSnapshot?.balance ?? "",
        currency: account.currency,
      };
    });
    setBalances(lastBalances);
  }

  function updateBalance(index: number, value: string) {
    setBalances((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], balance: value };
      return next;
    });
  }

  async function saveSnapshot() {
    const entries = balances
      .filter((b) => b.balance !== "" && !isNaN(parseFloat(b.balance)))
      .map((b) => ({
        accountId: b.accountId,
        balance: parseFloat(b.balance),
        currency: b.currency,
      }));

    const res = await fetch("/api/net-worth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, snapshotDate }),
    });

    if (res.ok) {
      toast.success(`Saved ${entries.length} account balances`);
      setIsRecording(false);
      fetchSnapshots();
    } else {
      toast.error("Failed to save snapshot");
    }
  }

  // Calculate totals from latest snapshot per account
  const latestByAccount = new Map<number, Snapshot>();
  for (const s of snapshots) {
    const existing = latestByAccount.get(s.accountId);
    if (!existing || s.snapshotDate > existing.snapshotDate) {
      latestByAccount.set(s.accountId, s);
    }
  }

  let totalNetWorthUSD = 0;
  let totalNetWorthILS = 0;
  const byOwnerUSD: Record<string, number> = {};
  const byOwnerILS: Record<string, number> = {};
  const byTypeUSD: Record<string, number> = {};
  const byTypeILS: Record<string, number> = {};

  for (const s of latestByAccount.values()) {
    const balance = parseFloat(s.balance);
    if (s.currency === "ILS") {
      totalNetWorthILS += balance;
      byOwnerILS[s.accountOwner] = (byOwnerILS[s.accountOwner] ?? 0) + balance;
      byTypeILS[s.accountType] = (byTypeILS[s.accountType] ?? 0) + balance;
    } else {
      totalNetWorthUSD += balance;
      byOwnerUSD[s.accountOwner] = (byOwnerUSD[s.accountOwner] ?? 0) + balance;
      byTypeUSD[s.accountType] = (byTypeUSD[s.accountType] ?? 0) + balance;
    }
  }

  // Historical chart: group by snapshot date, sum all balances
  const byDate: Record<string, number> = {};
  const dateAccounts: Record<string, Map<number, number>> = {};

  for (const s of snapshots) {
    if (!dateAccounts[s.snapshotDate]) {
      dateAccounts[s.snapshotDate] = new Map();
    }
    dateAccounts[s.snapshotDate].set(s.accountId, parseFloat(s.balance));
  }

  for (const [date, accountBalances] of Object.entries(dateAccounts)) {
    byDate[date] = Array.from(accountBalances.values()).reduce(
      (sum, b) => sum + b,
      0
    );
  }

  const chartData = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  // Filter out credit cards from balance recording
  const recordableAccounts = accounts.filter((a) => a.type !== "credit_card");
  const currentAccount = isRecording ? recordableAccounts[currentStep] : null;

  const typeLabels: Record<string, string> = {
    bank: "Bank",
    credit_card: "Credit Card",
    brokerage: "Brokerage",
    pension: "Pension",
    keren_hishtalmut: "Keren Hishtalmut",
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Net Worth</h2>
          <p className="text-muted-foreground">
            Track your total net worth across all accounts
          </p>
        </div>
        {!isRecording && (
          <Button onClick={startRecording} disabled={recordableAccounts.length === 0}>
            Record Balances
          </Button>
        )}
      </div>

      {/* Recording Flow */}
      {isRecording && (
        <Card>
          <CardHeader>
            <CardTitle>Record Balances</CardTitle>
            <CardDescription>
              Enter current balance for each account. Pre-filled with last known
              values.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Snapshot Date</Label>
              <Input
                type="date"
                value={snapshotDate}
                onChange={(e) => setSnapshotDate(e.target.value)}
                className="w-full sm:w-[200px]"
              />
            </div>

            {/* Prompted flow - one at a time */}
            {currentAccount && (
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {currentStep + 1} of {recordableAccounts.length}
                  </span>
                  <Badge variant="outline">{currentAccount.owner}</Badge>
                </div>
                <p className="text-lg font-medium">
                  What is the current balance in{" "}
                  <strong>{currentAccount.name}</strong>?
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {currentAccount.currency === "ILS" ? "\u20AA" : "$"}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Enter balance"
                    value={balances[currentStep]?.balance ?? ""}
                    onChange={(e) =>
                      updateBalance(currentStep, e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (currentStep < recordableAccounts.length - 1) {
                          setCurrentStep(currentStep + 1);
                        }
                      }
                    }}
                    className="w-full sm:w-[200px]"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  {currentStep > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentStep(currentStep - 1)}
                    >
                      Back
                    </Button>
                  )}
                  {currentStep < recordableAccounts.length - 1 ? (
                    <Button
                      size="sm"
                      onClick={() => setCurrentStep(currentStep + 1)}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button size="sm" onClick={saveSnapshot}>
                      Save All
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      updateBalance(currentStep, "");
                      if (currentStep < recordableAccounts.length - 1) {
                        setCurrentStep(currentStep + 1);
                      }
                    }}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            )}

            {/* Summary of entered values */}
            <div className="text-xs text-muted-foreground space-y-1">
              {balances
                .filter((b) => b.balance !== "")
                .map((b, i) => {
                  const account = accounts.find(
                    (a) => a.id === b.accountId
                  );
                  return (
                    <div key={i}>
                      {account?.name}: {b.currency === "ILS" ? "\u20AA" : "$"}
                      {parseFloat(b.balance).toLocaleString()}
                    </div>
                  );
                })}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsRecording(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Net Worth Summary */}
      {latestByAccount.size > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Net Worth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {ilsToUsd > 0
                    ? formatCurrency(totalNetWorthUSD + totalNetWorthILS * ilsToUsd, "USD")
                    : formatCurrency(totalNetWorthUSD, "USD")}
                  {ilsToUsd > 0 && (
                    <span className="text-2xl">
                      {" / "}
                      {formatCurrency(
                        totalNetWorthILS + totalNetWorthUSD / ilsToUsd,
                        "ILS"
                      )}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(totalNetWorthUSD, "USD")} + {formatCurrency(totalNetWorthILS, "ILS")}
                  {ilsToUsd > 0 && ` (rate: $1 = ${(1 / ilsToUsd).toFixed(2)} ILS)`}
                </p>
              </CardContent>
            </Card>
            {[...new Set([...Object.keys(byOwnerUSD), ...Object.keys(byOwnerILS)])].map((owner) => {
              const usd = byOwnerUSD[owner] ?? 0;
              const ils = byOwnerILS[owner] ?? 0;
              return (
                <Card key={owner}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {owner}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {ilsToUsd > 0
                        ? formatCurrency(usd + ils * ilsToUsd, "USD")
                        : formatCurrency(usd, "USD")}
                      {ilsToUsd > 0 && (
                        <span className="text-lg">
                          {" / "}
                          {formatCurrency(ils + usd / ilsToUsd, "ILS")}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* By Type */}
          <Card>
            <CardHeader>
              <CardTitle>By Account Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">ILS</TableHead>
                    <TableHead className="text-right">Total (USD)</TableHead>
                    <TableHead className="text-right">Total (ILS)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...new Set([...Object.keys(byTypeUSD), ...Object.keys(byTypeILS)])]
                    .sort((a, b) => {
                      const totalA = (byTypeUSD[a] ?? 0) + (byTypeILS[a] ?? 0) * ilsToUsd;
                      const totalB = (byTypeUSD[b] ?? 0) + (byTypeILS[b] ?? 0) * ilsToUsd;
                      return totalB - totalA;
                    })
                    .map((type) => {
                      const usd = byTypeUSD[type] ?? 0;
                      const ils = byTypeILS[type] ?? 0;
                      return (
                        <TableRow key={type}>
                          <TableCell>{typeLabels[type] ?? type}</TableCell>
                          <TableCell className="text-right font-medium">
                            {usd ? formatCurrency(usd, "USD") : "--"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {ils ? formatCurrency(ils, "ILS") : "--"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {ilsToUsd > 0
                              ? formatCurrency(usd + ils * ilsToUsd, "USD")
                              : formatCurrency(usd, "USD")}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {ilsToUsd > 0
                              ? formatCurrency(ils + usd / ilsToUsd, "ILS")
                              : formatCurrency(ils, "ILS")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>

          {/* Historical Chart */}
          {chartData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Net Worth Over Time</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip
                      formatter={(value) =>
                        formatCurrency(Number(value), "USD")
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#2563eb"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Latest Balances Table */}
          <Card>
            <CardHeader>
              <CardTitle>Latest Balances</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(latestByAccount.values())
                    .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))
                    .map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {s.accountName}
                        </TableCell>
                        <TableCell>{s.accountOwner}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {typeLabels[s.accountType] ?? s.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell>{s.snapshotDate}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(
                            parseFloat(s.balance),
                            s.currency
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {latestByAccount.size === 0 && !isRecording && (
        <Card>
          <CardContent className="flex h-[200px] items-center justify-center text-muted-foreground">
            No snapshots yet.{" "}
            {accounts.length === 0
              ? "Add accounts first, then record your balances."
              : 'Click "Record Balances" to get started.'}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
