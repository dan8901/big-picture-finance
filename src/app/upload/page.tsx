"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "sonner";

interface Account {
  id: number;
  name: string;
  institution: string;
  currency: string;
  owner: string;
}

interface PreviewTransaction {
  date: string;
  amount: number;
  currency: string;
  description: string;
  category?: string;
  sourceFile?: string;
  excluded?: boolean;
}

type UploadStep = "select" | "upload" | "preview" | "done";

export default function UploadPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<UploadStep>("select");
  const [preview, setPreview] = useState<PreviewTransaction[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [duplicates, setDuplicates] = useState<boolean[]>([]);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importHistory, setImportHistory] = useState<any[]>([]);
  const [parserFormats, setParserFormats] = useState<Record<string, string[]>>({});

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data);
  }, []);

  const fetchHistory = useCallback(async () => {
    const res = await fetch("/api/import-history");
    if (res.ok) setImportHistory(await res.json());
  }, []);

  const fetchFormats = useCallback(async () => {
    const res = await fetch("/api/upload/formats");
    if (res.ok) setParserFormats(await res.json());
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchHistory();
    fetchFormats();
  }, [fetchAccounts, fetchHistory, fetchFormats]);

  const selectedAccount = accounts.find(
    (a) => a.id === parseInt(selectedAccountId)
  );

  const acceptedFormats = selectedAccount
    ? parserFormats[selectedAccount.institution] ?? []
    : [];
  const acceptExtensions = acceptedFormats.length > 0
    ? acceptedFormats.flatMap((f) => f === "xlsx" ? [".xlsx", ".xls"] : [`.${f}`]).join(",")
    : ".csv,.xlsx,.xls,.pdf";

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const valid = validateFileFormats(Array.from(e.dataTransfer.files));
    if (valid.length > 0) setFiles((prev) => [...prev, ...valid]);
  }

  function validateFileFormats(newFiles: File[]): File[] {
    if (acceptedFormats.length === 0) return newFiles;
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of newFiles) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const normalized = ext === "xls" ? "xlsx" : ext;
      if (acceptedFormats.includes(normalized)) {
        valid.push(f);
      } else {
        rejected.push(f.name);
      }
    }
    if (rejected.length > 0) {
      toast.error(
        `${rejected.join(", ")} not supported. Accepted: ${acceptedFormats.map((f) => f.toUpperCase()).join(", ")}`
      );
    }
    return valid;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const valid = validateFileFormats(Array.from(e.target.files));
      if (valid.length > 0) setFiles((prev) => [...prev, ...valid]);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleParse() {
    if (!selectedAccount || files.length === 0) return;

    setParsing(true);
    const formData = new FormData();
    formData.set("institution", selectedAccount.institution);
    files.forEach((file) => formData.append("files", file));

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error);
        return;
      }

      setPreview(data.transactions);

      // Check for duplicates
      const dupRes = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: data.transactions,
          accountId: parseInt(selectedAccountId),
        }),
      });
      if (dupRes.ok) {
        const dupData = await dupRes.json();
        setDuplicates(dupData.duplicates);
      }

      setStep("preview");
    } catch {
      toast.error("Failed to parse files");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!selectedAccount || preview.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: preview,
          accountId: selectedAccount.id,
          filename: files.map((f) => f.name).join(", "),
          parser: selectedAccount.institution,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error);
        return;
      }

      setImportResult({ imported: data.imported, skipped: data.skipped });
      setStep("done");
      fetchHistory();
      toast.success(
        `Imported ${data.imported} transactions (${data.skipped} duplicates skipped)`
      );
    } catch {
      toast.error("Failed to import transactions");
    } finally {
      setImporting(false);
    }
  }

  function handleReset() {
    setFiles([]);
    setPreview([]);
    setDuplicates([]);
    setImportResult(null);
    setStep("select");
    setSelectedAccountId("");
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Upload Reports</h2>
        <p className="text-muted-foreground">
          Upload financial reports from your accounts
        </p>
      </div>

      {/* Step 1: Select Account */}
      <Card>
        <CardHeader>
          <CardTitle>1. Select Account</CardTitle>
          <CardDescription>
            Choose which account these reports belong to
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Label>Account</Label>
            <Select
              value={selectedAccountId}
              onValueChange={(v) => {
                setSelectedAccountId(v);
                if (v) setStep("upload");
              }}
              disabled={step === "preview" || step === "done"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.name} ({account.owner})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Upload Files */}
      {(step === "upload" || step === "preview") && (
        <Card>
          <CardHeader>
            <CardTitle>2. Upload Files</CardTitle>
            <CardDescription>
              {acceptedFormats.length > 0
                ? `Drop one or more ${acceptedFormats.map((f) => f.toUpperCase()).join("/")} files. Multiple monthly reports will be merged.`
                : "Drop one or more files. Multiple monthly reports will be merged."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex h-[150px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
            >
              <p className="text-sm text-muted-foreground">
                Drag & drop files here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {acceptedFormats.length > 0
                  ? `Accepts: ${acceptedFormats.map((f) => f.toUpperCase()).join(", ")}`
                  : "Supports CSV, XLSX, and PDF"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={acceptExtensions}
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </p>
                <div className="flex flex-wrap gap-2">
                  {files.map((file, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                    >
                      {file.name} &times;
                    </Badge>
                  ))}
                </div>
                <Button
                  onClick={handleParse}
                  disabled={parsing || step === "preview"}
                >
                  {parsing ? "Parsing..." : "Parse Files"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Preview & Import</CardTitle>
            <CardDescription>
              {(() => {
                const dupCount = duplicates.filter(Boolean).length;
                const newCount = preview.length - dupCount;
                if (dupCount === 0) return `Review ${preview.length} new transactions before importing`;
                if (newCount === 0) return `All ${preview.length} transactions are already in the database`;
                return `${newCount} new, ${dupCount} duplicates out of ${preview.length} parsed`;
              })()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[400px] overflow-auto rounded-md border">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Source File</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((tx, i) => ({ tx, i })).sort((a, b) => b.tx.date.localeCompare(a.tx.date)).map(({ tx, i }) => {
                    const isDup = duplicates[i];
                    return (
                    <TableRow key={i} className={isDup ? "opacity-30" : tx.excluded ? "opacity-40" : ""}>
                      <TableCell className="whitespace-nowrap">
                        {tx.date}
                      </TableCell>
                      <TableCell>
                        {tx.description}
                        {isDup && (
                          <span className="ml-2 text-xs text-muted-foreground" title="Matched by date + amount + description">
                            (duplicate — already imported)
                          </span>
                        )}
                        {!isDup && tx.excluded && (
                          <span className="ml-2 text-xs text-muted-foreground">(excluded)</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right whitespace-nowrap ${
                          tx.amount < 0 ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {tx.amount < 0 ? "-" : ""}
                        {tx.currency === "ILS" ? "\u20AA" : "$"}
                        {Math.abs(tx.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tx.sourceFile}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "Importing..." : `Import ${preview.length - duplicates.filter(Boolean).length} Transactions`}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Done */}
      {step === "done" && importResult && (
        <Card>
          <CardHeader>
            <CardTitle>Import Complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <p>
                <strong>{importResult.imported}</strong> transactions imported
              </p>
              {importResult.skipped > 0 && (
                <p>
                  <strong>{importResult.skipped}</strong> duplicates skipped
                </p>
              )}
            </div>
            <Button onClick={handleReset}>Upload More</Button>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      {importHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Import History</CardTitle>
            <CardDescription>Recent file imports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importHistory.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{log.accountName}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={log.filename}>
                        {log.filename}
                      </TableCell>
                      <TableCell className="text-right">{log.importedRows}</TableCell>
                      <TableCell className="text-right">{log.duplicateRows}</TableCell>
                      <TableCell className="text-right">{log.totalRows}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
