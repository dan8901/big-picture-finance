"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: string;
  currency: string;
  description: string;
  category: string | null;
}

interface Account {
  id: number;
  name: string;
}

export default function ExcludedPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterAccountId, setFilterAccountId] = useState<string>("all");

  const fetchData = useCallback(async () => {
    const [txRes, acctRes] = await Promise.all([
      fetch("/api/transactions?limit=10000"),
      fetch("/api/accounts"),
    ]);
    const data = await txRes.json();
    setTransactions(
      (data.transactions || []).filter((tx: { excluded: number }) => tx.excluded === 1)
    );
    setAccounts(await acctRes.json());
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const accountName = (id: number) =>
    accounts.find((a) => a.id === id)?.name ?? "Unknown";

  async function includeByDescription(description: string, acctId: number) {
    await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeByDescription: description, accountId: acctId }),
    });
    toast.success(
      `Included all "${description.substring(0, 30)}..." in ${accountName(acctId)}`
    );
    fetchData();
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filteredAndSorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredAndSorted.map((tx) => tx.id)));
    }
  }

  async function includeSelected() {
    await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), excluded: 0 }),
    });
    toast.success(`Included ${selected.size} transactions`);
    setSelected(new Set());
    fetchData();
  }

  const filteredAndSorted = useMemo(() => {
    let filtered = transactions;
    if (filterAccountId !== "all") {
      filtered = filtered.filter((tx) => tx.accountId === parseInt(filterAccountId));
    }
    return [...filtered].sort((a, b) => {
      if (sortBy === "date") {
        return sortDir === "asc"
          ? a.date.localeCompare(b.date)
          : b.date.localeCompare(a.date);
      }
      const aAmt = Math.abs(parseFloat(a.amount));
      const bAmt = Math.abs(parseFloat(b.amount));
      return sortDir === "asc" ? aAmt - bAmt : bAmt - aAmt;
    });
  }, [transactions, filterAccountId, sortBy, sortDir]);

  function toggleSort(col: "date" | "amount") {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  // Group by description + account for summary view
  const grouped = transactions.reduce(
    (acc, tx) => {
      const key = `${tx.accountId}::${tx.description.trim().toLowerCase()}`;
      if (!acc[key])
        acc[key] = {
          count: 0,
          total: 0,
          currency: tx.currency,
          accountId: tx.accountId,
          description: tx.description.trim(),
        };
      acc[key].count++;
      acc[key].total += Math.abs(parseFloat(tx.amount));
      return acc;
    },
    {} as Record<
      string,
      { count: number; total: number; currency: string; accountId: number; description: string }
    >
  );

  const sortedGroups = Object.values(grouped).sort(
    (a, b) => b.count - a.count
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          Excluded Transactions
        </h2>
        <p className="text-muted-foreground">
          {transactions.length} transactions excluded from dashboard
          calculations
        </p>
      </div>

      {/* Summary by description */}
      {sortedGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Excluded by Description</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedGroups.map((group) => (
                  <TableRow key={`${group.accountId}::${group.description}`}>
                    <TableCell className="max-w-[400px] truncate">
                      {group.description}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {accountName(group.accountId)}
                    </TableCell>
                    <TableCell className="text-right">{group.count}</TableCell>
                    <TableCell className="text-right">
                      {group.currency === "ILS" ? "\u20AA" : "$"}
                      {group.total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          includeByDescription(group.description, group.accountId)
                        }
                      >
                        Include all
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">
                {selected.size} selected
              </span>
              <Button size="sm" onClick={includeSelected}>
                Include Selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set())}
              >
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Excluded Transactions</CardTitle>
          <Select value={filterAccountId} onValueChange={setFilterAccountId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {filteredAndSorted.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              No excluded transactions.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        checked={
                          filteredAndSorted.length > 0 &&
                          selected.size === filteredAndSorted.length
                        }
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center gap-1 font-medium hover:text-foreground" onClick={() => toggleSort("date")}>
                        Date {sortBy === "date" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">
                      <button className="ml-auto flex items-center gap-1 font-medium hover:text-foreground" onClick={() => toggleSort("amount")}>
                        Amount {sortBy === "amount" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSorted.map((tx) => (
                    <TableRow
                      key={tx.id}
                      className={selected.has(tx.id) ? "bg-accent/50" : ""}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(tx.id)}
                          onChange={() => toggleSelect(tx.id)}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {tx.date}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {tx.description}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {accountName(tx.accountId)}
                      </TableCell>
                      <TableCell>
                        {tx.category ? (
                          <Badge variant="secondary">{tx.category}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell
                        className={`text-right whitespace-nowrap ${
                          parseFloat(tx.amount) < 0
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {parseFloat(tx.amount) < 0 ? "-" : ""}
                        {tx.currency === "ILS" ? "\u20AA" : "$"}
                        {Math.abs(parseFloat(tx.amount)).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2 }
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
