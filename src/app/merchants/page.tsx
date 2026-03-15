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
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Merchant {
  id: number;
  merchantName: string;
  displayName: string | null;
  category: string;
  isUserOverride: boolean;
  txCount: number;
  totalAmount: number;
}

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingDisplayNameKey, setEditingDisplayNameKey] = useState<string | null>(null);
  const [editingCategoryKey, setEditingCategoryKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [mergeCategory, setMergeCategory] = useState("");
  const [sortBy, setSortBy] = useState<"txCount" | "totalAmount">("txCount");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const fetchMerchants = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/merchants");
    const data = await res.json();
    setMerchants(data.merchants ?? []);
    setLoading(false);
  }, []);

  const fetchCategories = useCallback(async () => {
    const res = await fetch("/api/categories");
    const data = await res.json();
    setCategories((data.categories || []).map((c: { name: string }) => c.name));
  }, []);

  useEffect(() => {
    fetchMerchants();
    fetchCategories();
  }, [fetchMerchants, fetchCategories]);

  // Group merchants by display name for consolidated view
  const grouped = useMemo(() => {
    type GroupedMerchant = {
      key: string;
      displayName: string | null;
      rawNames: string[];
      category: string;
      txCount: number;
      totalAmount: number;
      ids: number[];
    };

    const groups = new Map<string, GroupedMerchant>();
    for (const m of merchants) {
      const key = m.displayName ?? m.merchantName;
      const existing = groups.get(key);
      if (existing) {
        existing.rawNames.push(m.merchantName);
        existing.txCount += m.txCount;
        existing.totalAmount += m.totalAmount;
        existing.ids.push(m.id);
      } else {
        groups.set(key, {
          key,
          displayName: m.displayName,
          rawNames: [m.merchantName],
          category: m.category,
          txCount: m.txCount,
          totalAmount: m.totalAmount,
          ids: [m.id],
        });
      }
    }

    let result = [...groups.values()];

    // Apply filters
    if (categoryFilter !== "all") {
      result = result.filter((g) => g.category === categoryFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.key.toLowerCase().includes(s) ||
          g.rawNames.some((n) => n.includes(s)) ||
          g.category.toLowerCase().includes(s)
      );
    }

    const mult = sortDir === "desc" ? 1 : -1;
    return result.sort((a, b) => (b[sortBy] - a[sortBy]) * mult);
  }, [merchants, search, categoryFilter, sortBy, sortDir]);

  const uniqueCategories = useMemo(
    () => [...new Set(merchants.map((m) => m.category))].sort(),
    [merchants]
  );

  async function updateDisplayName(merchantName: string, displayName: string) {
    const newName = displayName.trim() || null;
    setMerchants((prev) =>
      prev.map((m) => (m.merchantName === merchantName ? { ...m, displayName: newName } : m))
    );
    setEditingDisplayNameKey(null);
    const res = await fetch("/api/merchants", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantName, displayName: newName }),
    });
    if (!res.ok) {
      toast.error("Failed to update display name");
      fetchMerchants();
    }
  }

  async function updateCategory(merchantName: string, category: string) {
    setMerchants((prev) =>
      prev.map((m) => (m.merchantName === merchantName ? { ...m, category } : m))
    );
    setEditingCategoryKey(null);
    const res = await fetch("/api/merchants", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantName, category }),
    });
    if (!res.ok) {
      toast.error("Failed to update category");
      fetchMerchants();
    }
  }

  async function handleMerge() {
    if (!mergeName.trim() || !mergeCategory) {
      toast.error("Display name and category are required");
      return;
    }

    const merchantNames = [...selected];

    const res = await fetch("/api/merchants?action=merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantNames,
        displayName: mergeName.trim(),
        category: mergeCategory,
      }),
    });

    if (res.ok) {
      toast.success(`Merged ${merchantNames.length} merchants`);
      setSelected(new Set());
      setMergeDialogOpen(false);
      setMergeName("");
      setMergeCategory("");
      fetchMerchants();
    } else {
      toast.error("Merge failed");
    }
  }

  function toggleSelect(merchantName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(merchantName)) next.delete(merchantName);
      else next.add(merchantName);
      return next;
    });
  }

  function toggleSort(col: "txCount" | "totalAmount") {
    if (sortBy === col) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  const sortIndicator = (col: "txCount" | "totalAmount") =>
    sortBy === col ? (sortDir === "desc" ? " \u25BC" : " \u25B2") : "";

  function formatAmount(amount: number) {
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Merchants</h2>
        <p className="text-muted-foreground">
          Manage merchant display names and consolidate variants
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label>Search</Label>
              <Input
                placeholder="Search merchants..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-[250px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {uniqueCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(search || categoryFilter !== "all") && (
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setCategoryFilter("all");
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <Button
                onClick={() => {
                  const first = [...selected][0] ?? "";
                  const firstMerchant = merchants.find((m) => m.merchantName === first);
                  setMergeName(firstMerchant?.displayName ?? first);
                  setMergeCategory(firstMerchant?.category ?? categories[0] ?? "");
                  setMergeDialogOpen(true);
                }}
              >
                Merge Selected
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Merchants Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {grouped.length} Merchant{grouped.length !== 1 ? "s" : ""}
            {grouped.length !== merchants.length && ` (${merchants.length} raw)`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              Loading merchants...
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              No merchants found.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        checked={grouped.length > 0 && grouped.every((g) => g.rawNames.every((n) => selected.has(n)))}
                        onChange={() => {
                          const allVisible = new Set(grouped.flatMap((g) => g.rawNames));
                          const allSelected = [...allVisible].every((n) => selected.has(n));
                          if (allSelected) setSelected(new Set());
                          else setSelected(allVisible);
                        }}
                        className="rounded"
                      />
                    </TableHead>
                    <TableHead>Display Name</TableHead>
                    <TableHead>Raw Name(s)</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("txCount")}>
                      Transactions{sortIndicator("txCount")}
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("totalAmount")}>
                      Total Spent{sortIndicator("totalAmount")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map((group) => {
                    const isGroupSelected = group.rawNames.every((n) => selected.has(n));
                    return (
                      <TableRow key={group.key} className={isGroupSelected ? "bg-accent/50" : ""}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={isGroupSelected}
                            onChange={() => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (isGroupSelected) {
                                  group.rawNames.forEach((n) => next.delete(n));
                                } else {
                                  group.rawNames.forEach((n) => next.add(n));
                                }
                                return next;
                              });
                            }}
                            className="rounded"
                          />
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          {editingDisplayNameKey === group.key ? (
                            <Input
                              autoFocus
                              defaultValue={group.displayName ?? group.rawNames[0]}
                              className="h-7 text-xs"
                              onBlur={(e) => updateDisplayName(group.rawNames[0], e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") updateDisplayName(group.rawNames[0], (e.target as HTMLInputElement).value);
                                if (e.key === "Escape") setEditingDisplayNameKey(null);
                              }}
                            />
                          ) : (
                            <span
                              className="cursor-pointer hover:underline truncate block"
                              onClick={() => {
                                setEditingDisplayNameKey(group.key);
                                setEditingCategoryKey(null);
                              }}
                            >
                              {group.displayName ?? (
                                <span className="text-muted-foreground italic">
                                  {group.rawNames[0]}
                                </span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex flex-wrap gap-1">
                            {group.rawNames.slice(0, 3).map((name) => (
                              <Badge key={name} variant="outline" className="text-[10px] font-normal truncate max-w-[140px]" title={name}>
                                {name}
                              </Badge>
                            ))}
                            {group.rawNames.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{group.rawNames.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {editingCategoryKey === group.key ? (
                            <Select
                              value={group.category}
                              onValueChange={(v) => updateCategory(group.rawNames[0], v)}
                              open
                              onOpenChange={(open) => {
                                if (!open) setEditingCategoryKey(null);
                              }}
                            >
                              <SelectTrigger className="h-7 w-[160px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {categories.map((cat) => (
                                  <SelectItem key={cat} value={cat}>
                                    {cat}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span
                              className="cursor-pointer hover:underline"
                              onClick={() => {
                                setEditingCategoryKey(group.key);
                                setEditingDisplayNameKey(null);
                              }}
                            >
                              <Badge variant="secondary">{group.category}</Badge>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{group.txCount}</TableCell>
                        <TableCell className="text-right text-red-600">
                          {formatAmount(group.totalAmount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Merchants</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Merging {selected.size} merchants into one. All transactions will be grouped under the display name below.
            </p>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={mergeName}
                onChange={(e) => setMergeName(e.target.value)}
                placeholder="e.g. Amazon"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={mergeCategory} onValueChange={setMergeCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">
              Raw names being merged ({selected.size}):
              <div className="flex flex-wrap gap-1 mt-1 max-h-[120px] overflow-auto">
                {[...selected].slice(0, 20).map((name) => (
                  <Badge key={name} variant="outline" className="text-[10px]">
                    {name}
                  </Badge>
                ))}
                {selected.size > 20 && (
                  <Badge variant="outline" className="text-[10px]">
                    +{selected.size - 20} more
                  </Badge>
                )}
              </div>
            </div>
            <Button onClick={handleMerge} className="w-full">
              Merge
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
