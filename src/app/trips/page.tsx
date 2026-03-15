"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface TripTransaction {
  id: number;
  date: string;
  amount: string;
  currency: string;
  originalCurrency: string | null;
  originalAmount: string | null;
  description: string;
  category: string | null;
  accountName: string;
  note: string | null;
}

interface Trip {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  destination: string | null;
  totalUsd: number;
  totalIls: number;
  categoryBreakdown: Record<string, number>;
  txCount: number;
  perDayAvg: number;
  transactions: TripTransaction[];
}

interface TransactionSuggestion {
  id: number;
  date: string;
  amount: string;
  currency: string;
  originalCurrency: string | null;
  originalAmount: string | null;
  description: string;
  category: string | null;
  accountName: string;
  suggested: boolean;
  reason: string;
  amountUsd: number;
}

type WizardStep = 1 | 2 | 3;

const PlaneIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
);

const ChevronDown = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
);

const ChevronUp = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
);

function formatCurrency(amount: number, currency: "USD" | "ILS" = "USD") {
  const symbol = currency === "ILS" ? "\u20AA" : "$";
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateRange(start: string, end: string | null) {
  const s = new Date(start + "T00:00:00");
  const e = end ? new Date(end + "T00:00:00") : s;
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${e.getFullYear()}`;
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [yearSummary, setYearSummary] = useState({ count: 0, totalUsd: 0, totalIls: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedTripId, setExpandedTripId] = useState<number | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [deletingTripId, setDeletingTripId] = useState<number | null>(null);

  const fetchTrips = useCallback(async () => {
    try {
      const res = await fetch("/api/trips");
      const data = await res.json();
      setTrips(data.trips);
      setYearSummary(data.yearSummary);
    } catch {
      toast.error("Failed to load trips");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  async function handleDelete(tripId: number) {
    try {
      const res = await fetch(`/api/events?id=${tripId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDeletingTripId(null);
      toast.success("Trip deleted");
      fetchTrips();
    } catch {
      toast.error("Failed to delete trip");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Trips</h2>
          <p className="text-muted-foreground">Track and analyze your travel spending</p>
        </div>
        <Button onClick={() => setShowWizard(true)} className="shrink-0">
          + Add Trip
        </Button>
      </div>

      {/* Year Summary */}
      {trips.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {yearSummary.count} trip{yearSummary.count !== 1 ? "s" : ""} &middot; {formatCurrency(yearSummary.totalUsd)} total
        </div>
      )}

      {/* Trip Cards */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-6 w-48 bg-muted animate-pulse rounded" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : trips.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground mb-2">{PlaneIcon}</div>
            <p className="text-lg font-medium">No trips yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first trip to start tracking travel spending
            </p>
            <Button onClick={() => setShowWizard(true)}>+ Add Trip</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              expanded={expandedTripId === trip.id}
              onToggle={() => setExpandedTripId(expandedTripId === trip.id ? null : trip.id)}
              onEdit={() => setEditingTrip(trip)}
              onDelete={() => setDeletingTripId(trip.id)}
              onRemoveTransaction={async (txId) => {
                await fetch("/api/transactions/bulk", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: [txId], eventId: null }),
                });
                fetchTrips();
              }}
            />
          ))}
        </div>
      )}

      {/* Wizard Dialog */}
      {showWizard && (
        <AddTripWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            fetchTrips();
          }}
        />
      )}

      {/* Edit Dialog */}
      {editingTrip && (
        <EditTripDialog
          trip={editingTrip}
          onClose={() => setEditingTrip(null)}
          onSaved={() => {
            setEditingTrip(null);
            fetchTrips();
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deletingTripId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Delete Trip</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This will remove the trip and untag all its transactions. This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDeletingTripId(null)}>Cancel</Button>
                <Button variant="destructive" onClick={() => handleDelete(deletingTripId)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TripCard({
  trip,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onRemoveTransaction,
}: {
  trip: Trip;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemoveTransaction: (txId: number) => void;
}) {
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const filteredTxns = trip.transactions
    .filter((tx) => !search || tx.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortField === "date") return mul * a.date.localeCompare(b.date);
      return mul * (Math.abs(parseFloat(a.amount)) - Math.abs(parseFloat(b.amount)));
    });

  const SortArrow = ({ field }: { field: "date" | "amount" }) =>
    sortField === field ? (sortDir === "asc" ? " \u2191" : " \u2193") : null;

  // Top 3 categories by USD amount
  const topCategories = Object.entries(trip.categoryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={onToggle}
          className="w-full p-6 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{PlaneIcon}</span>
                <h3 className="text-lg font-semibold">{trip.name}</h3>
                {trip.destination && (
                  <span className="text-sm text-muted-foreground">— {trip.destination}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDateRange(trip.startDate, trip.endDate)}
              </p>
              {topCategories.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {topCategories.map(([cat, amt]) => `${cat} ${formatCurrency(amt)}`).join(" · ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {trip.txCount} transaction{trip.txCount !== 1 ? "s" : ""} · {formatCurrency(trip.perDayAvg)}/day
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-lg font-semibold">{formatCurrency(trip.totalUsd)}</div>
                <div className="text-xs text-muted-foreground">{formatCurrency(trip.totalIls, "ILS")}</div>
              </div>
              <span className="text-muted-foreground">{expanded ? ChevronUp : ChevronDown}</span>
            </div>
          </div>
        </button>

        {expanded && (
          <div className="border-t px-6 pb-6">
            <div className="flex gap-2 justify-end py-3">
              <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
              <Button variant="outline" size="sm" onClick={onDelete} className="text-red-600 hover:text-red-700">Delete</Button>
            </div>
            {trip.transactions.length > 0 ? (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Search transactions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full max-w-xs px-3 py-1.5 text-sm rounded-md border bg-background"
                />
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => toggleSort("date")}>Date<SortArrow field="date" /></th>
                      <th className="pb-2 pr-4">Description</th>
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4">Account</th>
                      <th className="pb-2 text-right cursor-pointer select-none" onClick={() => toggleSort("amount")}>Amount<SortArrow field="amount" /></th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTxns.map((tx) => {
                      const amt = parseFloat(tx.amount);
                      const symbol = tx.currency === "ILS" ? "\u20AA" : "$";
                      return (
                        <tr key={tx.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 whitespace-nowrap">{formatDate(tx.date)}</td>
                          <td className="py-2 pr-4 max-w-[300px] truncate" title={tx.description}>
                            {tx.description}
                            {tx.originalCurrency && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({Math.abs(parseFloat(tx.originalAmount ?? "0")).toFixed(2)} {tx.originalCurrency})
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">{tx.category ?? "—"}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{tx.accountName}</td>
                          <td className="py-2 text-right whitespace-nowrap text-red-600">
                            -{symbol}{Math.abs(amt).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 pl-2">
                            <button
                              onClick={() => onRemoveTransaction(tx.id)}
                              className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                              title="Remove from trip"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No transactions tagged to this trip.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddTripWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [destination, setDestination] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [duringTrip, setDuringTrip] = useState<TransactionSuggestion[]>([]);
  const [preTripBookings, setPreTripBookings] = useState<TransactionSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  async function handleDetect() {
    setStep(2);
    setDetecting(true);
    try {
      const res = await fetch("/api/trips/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, destination: destination || undefined }),
      });

      if (!res.ok) throw new Error();

      const data = await res.json();
      setDuringTrip(data.duringTrip);
      setPreTripBookings(data.preTripBookings);

      // Pre-select suggested transactions
      const suggested = new Set<number>();
      for (const tx of [...data.duringTrip, ...data.preTripBookings]) {
        if (tx.suggested) suggested.add(tx.id);
      }
      setSelectedIds(suggested);
      setStep(3);
    } catch {
      toast.error("Failed to analyze transactions. Showing all during-trip transactions.");
      // Fallback: try to load without LLM
      try {
        const res = await fetch("/api/trips/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate, endDate }),
        });
        if (res.ok) {
          const data = await res.json();
          setDuringTrip(data.duringTrip);
          setPreTripBookings(data.preTripBookings);
          const allDuring = new Set<number>(data.duringTrip.map((tx: TransactionSuggestion) => tx.id));
          setSelectedIds(allDuring);
        }
      } catch {
        // Give up
      }
      setStep(3);
    } finally {
      setDetecting(false);
    }
  }

  async function handleSave() {
    if (selectedIds.size === 0 && !confirm("No transactions selected. Create the trip anyway?")) return;

    setSaving(true);
    try {
      // Create the event
      const eventRes = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: "trip",
          startDate,
          endDate,
          destination: destination || undefined,
        }),
      });
      if (!eventRes.ok) throw new Error();
      const event = await eventRes.json();

      // Tag transactions
      if (selectedIds.size > 0) {
        const tagRes = await fetch("/api/transactions/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selectedIds],
            eventId: event.id,
          }),
        });
        if (!tagRes.ok) throw new Error();
      }

      toast.success(`Trip "${name}" created with ${selectedIds.size} transactions`);
      onCreated();
    } catch {
      toast.error("Failed to create trip");
    } finally {
      setSaving(false);
    }
  }

  function toggleTransaction(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(txns: TransactionSuggestion[], select: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const tx of txns) {
        if (select) next.add(tx.id);
        else next.delete(tx.id);
      }
      return next;
    });
  }

  // Calculate running total
  const allTxns = [...duringTrip, ...preTripBookings];
  const selectedTotal = allTxns
    .filter((tx) => selectedIds.has(tx.id))
    .reduce((sum, tx) => sum + tx.amountUsd, 0);
  const selectedCount = selectedIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-4xl max-h-[85vh] flex flex-col">
        <CardHeader>
          <CardTitle>
            {step === 1 ? "Add Trip — Details" : step === 2 ? "Analyzing Transactions..." : "Review Transactions"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-4">
          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="trip-name">Trip Name *</Label>
                <Input
                  id="trip-name"
                  placeholder="e.g., Berlin Weekend"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="trip-start">Start Date *</Label>
                  <Input
                    id="trip-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trip-end">End Date *</Label>
                  <Input
                    id="trip-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="trip-dest">Destination (optional)</Label>
                <Input
                  id="trip-dest"
                  placeholder="e.g., Berlin, Germany"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button
                  onClick={handleDetect}
                  disabled={!name || !startDate || !endDate}
                >
                  Next
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center gap-3 py-12">
              <svg className="h-8 w-8 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-muted-foreground">Analyzing your transactions...</p>
              <p className="text-xs text-muted-foreground">Looking for trip expenses and pre-trip bookings</p>
            </div>
          )}

          {step === 3 && (
            <>
              {/* During Trip Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">During trip ({duringTrip.length})</h3>
                  <div className="flex gap-2">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleAll(duringTrip, true)}
                    >
                      Select all
                    </button>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleAll(duringTrip, false)}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>
                {duringTrip.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transactions found in this date range.</p>
                ) : (
                  <TransactionCheckList
                    transactions={duringTrip}
                    selectedIds={selectedIds}
                    onToggle={toggleTransaction}
                  />
                )}
              </div>

              {/* Pre-trip Bookings Section */}
              {preTripBookings.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">Pre-trip bookings ({preTripBookings.length})</h3>
                    <div className="flex gap-2">
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => toggleAll(preTripBookings, true)}
                      >
                        Select all
                      </button>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => toggleAll(preTripBookings, false)}
                      >
                        Deselect all
                      </button>
                    </div>
                  </div>
                  <TransactionCheckList
                    transactions={preTripBookings}
                    selectedIds={selectedIds}
                    onToggle={toggleTransaction}
                  />
                </div>
              )}

              {/* Running Total */}
              <div className="border-t pt-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium">{formatCurrency(selectedTotal)}</span>
                  <span className="text-muted-foreground"> from {selectedCount} transaction{selectedCount !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>Cancel</Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Creating..." : "Create Trip"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TransactionCheckList({
  transactions,
  selectedIds,
  onToggle,
}: {
  transactions: TransactionSuggestion[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const hasReasons = transactions.some((tx) => tx.reason);
  return (
    <div>
      <div className="flex items-center gap-3 px-2 pb-1 text-xs font-medium text-muted-foreground border-b">
        <span className="w-4 shrink-0" />
        <span className="w-20 shrink-0">Date</span>
        <span className="flex-1">Description</span>
        <span className="w-24 text-right shrink-0">Amount</span>
        <span className="w-24 shrink-0">Account</span>
        {hasReasons && <span className="w-44 shrink-0">Reason</span>}
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {[...transactions].sort((a, b) => {
          const aSelected = selectedIds.has(a.id) ? 0 : 1;
          const bSelected = selectedIds.has(b.id) ? 0 : 1;
          if (aSelected !== bSelected) return aSelected - bSelected;
          return b.date.localeCompare(a.date);
        }).map((tx) => {
          const amt = parseFloat(tx.amount);
          const symbol = tx.currency === "ILS" ? "\u20AA" : "$";
          return (
            <label
              key={tx.id}
              className="flex items-center gap-3 p-2 rounded hover:bg-accent/30 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(tx.id)}
                onChange={() => onToggle(tx.id)}
                className="rounded"
              />
              <span className="w-20 shrink-0 text-muted-foreground">{formatDate(tx.date)}</span>
              <span className="flex-1 truncate" title={tx.description}>
                {tx.description}
                {tx.originalCurrency && (
                  <span className="ml-1 text-xs text-blue-500">
                    {tx.originalCurrency}
                  </span>
                )}
              </span>
              <span className="w-24 text-right shrink-0 text-red-600">
                -{symbol}{Math.abs(amt).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="w-24 shrink-0 text-xs text-muted-foreground truncate">{tx.accountName}</span>
              {hasReasons && (
                <span className="w-44 shrink-0 text-xs text-muted-foreground/60 italic truncate" title={tx.reason}>
                  {tx.reason ? `— ${tx.reason}` : ""}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function EditTripDialog({
  trip,
  onClose,
  onSaved,
}: {
  trip: Trip;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate ?? "");
  const [destination, setDestination] = useState(trip.destination ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trip.id, name, startDate, endDate, destination }),
      });
      if (!res.ok) throw new Error();
      toast.success("Trip updated");
      onSaved();
    } catch {
      toast.error("Failed to update trip");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Edit Trip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Trip Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-start">Start Date</Label>
              <Input id="edit-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-end">End Date</Label>
              <Input id="edit-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-dest">Destination</Label>
            <Input id="edit-dest" value={destination} onChange={(e) => setDestination(e.target.value)} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name || !startDate}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
