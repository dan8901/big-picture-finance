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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface Account {
  id: number;
  name: string;
  type: string;
  institution: string | null;
  currency: string;
  owner: string;
}

const ACCOUNT_TYPES = [
  { value: "bank", label: "Bank (statements)" },
  { value: "credit_card", label: "Credit Card (statements)" },
  { value: "brokerage", label: "Brokerage (balance only)" },
  { value: "pension", label: "Pension (balance only)" },
  { value: "keren_hishtalmut", label: "Keren Hishtalmut (balance only)" },
];

const INSTITUTIONS = [
  { value: "isracard", label: "Isracard" },
  { value: "cal", label: "Cal" },
  { value: "max", label: "Max" },
  { value: "discover", label: "Discover" },
  { value: "sdfcu", label: "State Dept FCU" },
  { value: "fidelity", label: "Fidelity" },
  { value: "bank-hapoalim", label: "Bank Hapoalim" },
  { value: "pepper", label: "Pepper Bank" },
];

const TRANSACTION_TYPES = ["bank", "credit_card"];

const CURRENCIES = [
  { value: "USD", label: "USD ($)" },
  { value: "ILS", label: "ILS (\u20AA)" },
];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "",
    institution: "",
    currency: "",
    owner: "",
  });

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ name: "", type: "", institution: "", currency: "", owner: "" });
    setDialogOpen(false);
    fetchAccounts();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/accounts?id=${deleteTarget.id}`, {
      method: "DELETE",
    });
    setDeleteTarget(null);
    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Failed to delete account");
      return;
    }
    fetchAccounts();
  }

  const isTransactionType = TRANSACTION_TYPES.includes(form.type);

  const institutionLabel = (value: string) =>
    INSTITUTIONS.find((i) => i.value === value)?.label ?? value;

  const typeLabel = (value: string) =>
    ACCOUNT_TYPES.find((t) => t.value === value)?.label ?? value;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Accounts</h2>
          <p className="text-muted-foreground">
            Manage your financial accounts
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>Add Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({
                    ...form,
                    type: v,
                    institution: TRANSACTION_TYPES.includes(v) ? form.institution : "",
                  })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isTransactionType ? (
                <div className="space-y-2">
                  <Label>Institution</Label>
                  <Select
                    value={form.institution}
                    onValueChange={(v) => setForm({ ...form, institution: v })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select institution" />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTITUTIONS.map((i) => (
                        <SelectItem key={i.value} value={i.value}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="name">Account Name</Label>
                <Input
                  id="name"
                  placeholder={isTransactionType ? "Optional — defaults to Institution - Owner" : "e.g. Meitav Pension"}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required={!isTransactionType}
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
                <Label htmlFor="owner">Owner</Label>
                <Input
                  id="owner"
                  placeholder="e.g. Daniel, Sarah, Shared"
                  value={form.owner}
                  onChange={(e) =>
                    setForm({ ...form, owner: e.target.value })
                  }
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                Add Account
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Accounts ({accounts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              No accounts yet. Add your first account to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      {account.name}
                    </TableCell>
                    <TableCell>{account.institution ? institutionLabel(account.institution) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {typeLabel(account.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>{account.currency}</TableCell>
                    <TableCell>{account.owner}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(account)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</DialogTitle>
            <DialogDescription>
              This action is irreversible. All transactions, net worth snapshots, exclusion rules, and import history associated with this account will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
