"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  eventId: number | null;
  sourceFile: string | null;
  excluded: number;
}

interface Account {
  id: number;
  name: string;
  owner: string;
}

interface Event {
  id: number;
  name: string;
  type: string;
  startDate: string;
  endDate: string | null;
}

const STANDARD_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Housing & Utilities",
  "Health & Insurance",
  "Shopping & Clothing",
  "Entertainment & Leisure",
  "Transfers",
  "Government & Taxes",
  "Other",
];

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set());
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "expenses" | "income">("all");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [actionsForTx, setActionsForTx] = useState<Transaction | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  const [catStatus, setCatStatus] = useState("");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [newEvent, setNewEvent] = useState({
    name: "",
    type: "trip",
    startDate: "",
    endDate: "",
  });

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("limit", "10000");
    params.set("offset", "0");
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);

    const res = await fetch(`/api/transactions?${params}`);
    const data = await res.json();
    setTransactions(data.transactions);
    setLoading(false);
  }, [startDate, endDate, sortBy, sortDir]);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    setAccounts(await res.json());
  }, []);

  const fetchEvents = useCallback(async () => {
    const res = await fetch("/api/events");
    setEvents(await res.json());
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchEvents();
  }, [fetchAccounts, fetchEvents]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const accountName = (accountId: number) =>
    accountMap.get(accountId)?.name ?? "Unknown";
  const accountOwner = (accountId: number) =>
    accountMap.get(accountId)?.owner ?? "Unknown";

  const eventName = (eventId: number | null) =>
    eventId ? events.find((e) => e.id === eventId)?.name : null;

  const uniqueCategories = useMemo(
    () =>
      [
        ...new Set(
          transactions
            .map((tx) => tx.category)
            .filter((c): c is string => c !== null && c !== "")
        ),
      ].sort(),
    [transactions]
  );

  const uniqueOwners = useMemo(
    () => [...new Set(accounts.map((a) => a.owner))].sort(),
    [accounts]
  );

  const sorted = useMemo(() => {
    return transactions.filter((tx) => {
      if (!showExcluded && tx.excluded) return false;
      if (typeFilter === "expenses" && parseFloat(tx.amount) >= 0) return false;
      if (typeFilter === "income" && parseFloat(tx.amount) < 0) return false;
      if (accountFilter.size > 0 && !accountFilter.has(String(tx.accountId)))
        return false;
      if (ownerFilter !== "all" && accountOwner(tx.accountId) !== ownerFilter)
        return false;
      if (categoryFilter.size > 0) {
        if (categoryFilter.has("uncategorized") && !tx.category) return true;
        if (tx.category && categoryFilter.has(tx.category)) return true;
        if (!categoryFilter.has("uncategorized") && !tx.category) return false;
        if (!tx.category || !categoryFilter.has(tx.category)) return false;
      }
      if (search) {
        return (
          tx.description.toLowerCase().includes(search.toLowerCase()) ||
          tx.category?.toLowerCase().includes(search.toLowerCase())
        );
      }
      return true;
    });
  }, [transactions, showExcluded, typeFilter, accountFilter, ownerFilter, categoryFilter, search, accountMap]);

  function toggleSort(col: "date" | "amount") {
    if (sortBy === col) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  const sortIndicator = (col: "date" | "amount") =>
    sortBy === col ? (sortDir === "desc" ? " \u25BC" : " \u25B2") : "";

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((tx) => tx.id)));
    }
  }

  async function assignEvent(eventId: number) {
    const affectedIds = new Set(selected);
    setTransactions((prev) =>
      prev.map((tx) => (affectedIds.has(tx.id) ? { ...tx, eventId } : tx))
    );
    setSelected(new Set());
    toast.success(`Tagged ${affectedIds.size} transactions`);
    const res = await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(affectedIds), eventId }),
    });
    if (!res.ok) {
      toast.error("Failed to tag");
      fetchTransactions();
    }
  }

  async function excludeSelected(exclude: boolean) {
    const affectedIds = new Set(selected);
    setTransactions((prev) =>
      prev.map((tx) =>
        affectedIds.has(tx.id) ? { ...tx, excluded: exclude ? 1 : 0 } : tx
      )
    );
    setSelected(new Set());
    toast.success(
      exclude
        ? `Excluded ${affectedIds.size} transactions`
        : `Included ${affectedIds.size} transactions`
    );
    const res = await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: Array.from(affectedIds),
        excluded: exclude ? 1 : 0,
      }),
    });
    if (!res.ok) {
      toast.error("Failed to update");
      fetchTransactions();
    }
  }

  async function setCategoryByDescription(
    description: string,
    txAccountId: number,
    category: string
  ) {
    await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryByDescription: { description, category },
        accountId: txAccountId,
      }),
    });
    toast.success(`Set "${description.substring(0, 20)}..." → ${category}`);
    fetchTransactions();
  }

  async function excludeByDescription(description: string, txAccountId: number) {
    await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludeByDescription: description, accountId: txAccountId }),
    });
    toast.success(`Excluded all "${description.substring(0, 30)}..." in ${accountName(txAccountId)}`);
    fetchTransactions();
  }

  async function removeEventTag() {
    const affectedIds = new Set(selected);
    setTransactions((prev) =>
      prev.map((tx) =>
        affectedIds.has(tx.id) ? { ...tx, eventId: null } : tx
      )
    );
    setSelected(new Set());
    toast.success("Removed event tags");
    const res = await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(affectedIds), eventId: null }),
    });
    if (!res.ok) {
      toast.error("Failed to remove tags");
      fetchTransactions();
    }
  }

  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEvent),
    });
    const event = await res.json();
    setEventDialogOpen(false);
    setNewEvent({ name: "", type: "trip", startDate: "", endDate: "" });
    fetchEvents();
    if (selected.size > 0) {
      await assignEvent(event.id);
    }
  }

  async function updateCategory(txId: number, category: string) {
    const newCategory = category || null;
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, category: newCategory } : tx))
    );
    const res = await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [txId], category: newCategory }),
    });
    if (!res.ok) {
      toast.error("Failed to update category");
      fetchTransactions();
    }
  }

  async function handleCategorize() {
    setCategorizing(true);
    try {
      // Step 1: Normalize existing categories
      setCatStatus("Normalizing...");
      await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "normalize" }),
      });

      // Step 2: Get uncategorized descriptions (applies cache too)
      setCatStatus("Checking cache...");
      const uncatRes = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-uncategorized" }),
      });
      const { descriptions, cachedApplied } = await uncatRes.json() as {
        descriptions: string[];
        cachedApplied: number;
      };

      // Step 3: LLM categorization in batches
      const BATCH_SIZE = 50;
      let done = 0;

      if (descriptions.length > 0) {
        for (let i = 0; i < descriptions.length; i += BATCH_SIZE) {
          const batch = descriptions.slice(i, i + BATCH_SIZE);
          setCatStatus(`AI categorizing ${done}/${descriptions.length}...`);
          await fetch("/api/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "categorize-batch", descriptions: batch }),
          });
          done += batch.length;
        }
      }

      // Step 4: Detect recurring
      setCatStatus("Detecting recurring...");
      await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detect-recurring" }),
      });

      toast.success(
        `Done: ${cachedApplied} from cache, ${descriptions.length} by AI`
      );
      fetchTransactions();
    } catch {
      toast.error("Categorization failed");
    } finally {
      setCategorizing(false);
      setCatStatus("");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Transactions</h2>
        <p className="text-muted-foreground">
          View and manage all your transactions
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={handleCategorize}
          disabled={categorizing}
        >
          {categorizing ? catStatus || "Categorizing..." : "Categorize Transactions"}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label>Search</Label>
              <Input
                placeholder="Search description or category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-[250px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Account</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full sm:w-[200px] justify-start font-normal">
                    {accountFilter.size === 0
                      ? "All Accounts"
                      : accountFilter.size === 1
                        ? accountName(parseInt([...accountFilter][0]))
                        : `${accountFilter.size} accounts`}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[200px]">
                  {accounts.map((a) => (
                    <DropdownMenuCheckboxItem
                      key={a.id}
                      checked={accountFilter.has(String(a.id))}
                      onCheckedChange={(checked) => {
                        const next = new Set(accountFilter);
                        if (checked) next.add(String(a.id));
                        else next.delete(String(a.id));
                        setAccountFilter(next);
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {a.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-1">
              <Label>Owner</Label>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  {uniqueOwners.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full sm:w-[200px] justify-start font-normal">
                    {categoryFilter.size === 0
                      ? "All Categories"
                      : categoryFilter.size === 1
                        ? [...categoryFilter][0]
                        : `${categoryFilter.size} categories`}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[220px]">
                  <DropdownMenuCheckboxItem
                    checked={categoryFilter.has("uncategorized")}
                    onCheckedChange={(checked) => {
                      const next = new Set(categoryFilter);
                      if (checked) next.add("uncategorized");
                      else next.delete("uncategorized");
                      setCategoryFilter(next);
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    Uncategorized
                  </DropdownMenuCheckboxItem>
                  {uniqueCategories.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c}
                      checked={categoryFilter.has(c)}
                      onCheckedChange={(checked) => {
                        const next = new Set(categoryFilter);
                        if (checked) next.add(c);
                        else next.delete(c);
                        setCategoryFilter(next);
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {c}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[calc(50%-0.5rem)] sm:w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[calc(50%-0.5rem)] sm:w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <div className="flex gap-1">
                {(["all", "expenses", "income"] as const).map((t) => (
                  <Button
                    key={t}
                    variant={typeFilter === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTypeFilter(t)}
                  >
                    {t === "all" ? "All" : t === "expenses" ? "Expenses" : "Income"}
                  </Button>
                ))}
              </div>
            </div>
            {(search || accountFilter.size > 0 || ownerFilter !== "all" || categoryFilter.size > 0 || typeFilter !== "all" || startDate || endDate) && (
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setAccountFilter(new Set());
                    setOwnerFilter("all");
                    setCategoryFilter(new Set());
                    setTypeFilter("all");
                    setStartDate("");
                    setEndDate("");
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            )}
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExcluded}
                  onChange={(e) => setShowExcluded(e.target.checked)}
                  className="rounded"
                />
                Show excluded
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">
                {selected.size} selected
              </span>
              <Select onValueChange={(v) => assignEvent(parseInt(v))}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Assign to event..." />
                </SelectTrigger>
                <SelectContent>
                  {events.map((ev) => (
                    <SelectItem key={ev.id} value={String(ev.id)}>
                      {ev.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    New Event
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Event</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateEvent} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        placeholder="e.g. Berlin Weekend"
                        value={newEvent.name}
                        onChange={(e) =>
                          setNewEvent({ ...newEvent, name: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select
                        value={newEvent.type}
                        onValueChange={(v) =>
                          setNewEvent({ ...newEvent, type: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="trip">Trip</SelectItem>
                          <SelectItem value="one_time">One-time Expense</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Start Date</Label>
                        <Input
                          type="date"
                          value={newEvent.startDate}
                          onChange={(e) =>
                            setNewEvent({
                              ...newEvent,
                              startDate: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>End Date</Label>
                        <Input
                          type="date"
                          value={newEvent.endDate}
                          onChange={(e) =>
                            setNewEvent({
                              ...newEvent,
                              endDate: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <Button type="submit" className="w-full">
                      Create & Assign Selected
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
              <Button variant="ghost" size="sm" onClick={removeEventTag}>
                Remove Event Tag
              </Button>
              <Select
                onValueChange={(cat) => {
                  const affectedIds = new Set(selected);
                  setTransactions((prev) =>
                    prev.map((tx) =>
                      affectedIds.has(tx.id) ? { ...tx, category: cat } : tx
                    )
                  );
                  setSelected(new Set());
                  toast.success(`Set category → ${cat}`);
                  fetch("/api/transactions/bulk", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ids: Array.from(affectedIds),
                      category: cat,
                    }),
                  }).then((res) => {
                    if (!res.ok) {
                      toast.error("Failed to set category");
                      fetchTransactions();
                    }
                  });
                }}
              >
                <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs">
                  <SelectValue placeholder="Set category..." />
                </SelectTrigger>
                <SelectContent>
                  {STANDARD_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => excludeSelected(true)}
              >
                Exclude
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => excludeSelected(false)}
              >
                Include
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

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {sorted.length} Transaction{sorted.length !== 1 ? "s" : ""}
            {sorted.length !== transactions.length && ` (filtered from ${transactions.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && transactions.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              Loading transactions...
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              {transactions.length === 0
                ? "No transactions yet. Upload reports to import transactions."
                : "No transactions match your filters."}
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
                          sorted.length > 0 &&
                          selected.size === sorted.length
                        }
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("date")}
                    >
                      Date{sortIndicator("date")}
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none"
                      onClick={() => toggleSort("amount")}
                    >
                      Amount{sortIndicator("amount")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((tx) => (
                    <TableRow
                      key={tx.id}
                      className={`${selected.has(tx.id) ? "bg-accent/50" : ""} ${tx.excluded ? "opacity-40" : ""}`}
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
                      <TableCell className="max-w-[300px]">
                        <div className="flex items-center gap-1 group/row">
                          <span
                            className={`truncate ${tx.excluded ? "line-through" : ""}`}
                            title={tx.description}
                          >
                            {tx.description}
                          </span>
                          {!tx.excluded && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1 text-xs opacity-0 group-hover/row:opacity-100 shrink-0"
                              onClick={() => setActionsForTx(tx)}
                            >
                              Actions
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {accountName(tx.accountId)}
                      </TableCell>
                      <TableCell>
                        {editingCategoryId === tx.id ? (
                          <Select
                            value={tx.category ?? "uncategorized"}
                            onValueChange={(v) => {
                              updateCategory(tx.id, v === "uncategorized" ? "" : v);
                              setEditingCategoryId(null);
                            }}
                            open
                            onOpenChange={(open) => {
                              if (!open) setEditingCategoryId(null);
                            }}
                          >
                            <SelectTrigger className="h-7 w-[160px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="uncategorized">
                                Uncategorized
                              </SelectItem>
                              {STANDARD_CATEGORIES.map((cat) => (
                                <SelectItem key={cat} value={cat}>
                                  {cat}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span
                            className="text-xs cursor-pointer hover:underline"
                            onClick={() => setEditingCategoryId(tx.id)}
                          >
                            {tx.category ? (
                              <Badge variant="secondary">{tx.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">Uncategorized</span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {tx.eventId ? (
                          <Badge variant="outline">
                            {eventName(tx.eventId)}
                          </Badge>
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

      {/* Shared Actions Menu */}
      {actionsForTx && (
        <Dialog open={!!actionsForTx} onOpenChange={(open) => { if (!open) setActionsForTx(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-sm truncate">
                Actions for: {actionsForTx.description}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  excludeByDescription(actionsForTx.description, actionsForTx.accountId);
                  setActionsForTx(null);
                }}
              >
                Exclude all with this description
              </Button>
              <div className="border-t pt-2">
                <p className="text-xs text-muted-foreground mb-2">Set category for all with this description:</p>
                <div className="grid grid-cols-2 gap-1">
                  {STANDARD_CATEGORIES.map((cat) => (
                    <Button
                      key={cat}
                      variant="ghost"
                      size="sm"
                      className="justify-start text-xs h-8"
                      onClick={() => {
                        setCategoryByDescription(
                          actionsForTx.description,
                          actionsForTx.accountId,
                          cat
                        );
                        setActionsForTx(null);
                      }}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
