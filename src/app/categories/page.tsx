"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Category = {
  id: number;
  name: string;
  isDefault: number;
  sortOrder: number;
};

type GoalInfo = {
  id: number;
  name: string;
  type: string;
  category: string;
};

type WizardStep = "categories" | "mappings" | "goals" | "review";

// Wizard category entry (local state, not yet persisted)
type WizardCategory = {
  tempId: string;
  name: string;
  isNew: boolean;
  originalName?: string; // if renamed, tracks old name
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [goalCounts, setGoalCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Wizard state
  const [wizardActive, setWizardActive] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("categories");
  const [wizardCategories, setWizardCategories] = useState<WizardCategory[]>([]);
  const [wizardNewName, setWizardNewName] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [aiRecategorize, setAiRecategorize] = useState<Set<string>>(new Set());
  const [affectedGoals, setAffectedGoals] = useState<GoalInfo[]>([]);
  const [goalActions, setGoalActions] = useState<Record<number, "reassign" | "delete">>({});
  const [goalReassignTargets, setGoalReassignTargets] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [wizardLoading, setWizardLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/categories");
    const data = await res.json();
    setCategories(data.categories || []);
    setCategoryCounts(data.categoryCounts || {});
    setGoalCounts(data.goalCounts || {});
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  async function handleAdd() {
    if (!newCategoryName.trim()) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName.trim() }),
    });
    if (res.ok) {
      toast.success(`Added "${newCategoryName.trim()}"`);
      setNewCategoryName("");
      setAddDialogOpen(false);
      fetchCategories();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to add category");
    }
  }

  async function handleDelete(id: number) {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    const txCount = categoryCounts[cat.name] || 0;
    const gCount = goalCounts[cat.name] || 0;
    if (txCount > 0 || gCount > 0) {
      toast.error(
        `"${cat.name}" has ${txCount > 0 ? `${txCount.toLocaleString()} transactions` : ""}${txCount > 0 && gCount > 0 ? " and " : ""}${gCount > 0 ? `${gCount} goal${gCount !== 1 ? "s" : ""}` : ""}. Use "Reconfigure" to migrate them first.`
      );
      return;
    }
    const res = await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      toast.success(`Removed "${cat.name}"`);
      fetchCategories();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to delete");
    }
  }

  function startRename(cat: Category) {
    setRenamingId(cat.id);
    setRenameValue(cat.name);
  }

  async function saveRename() {
    if (renamingId === null) return;
    const cat = categories.find((c) => c.id === renamingId);
    if (!cat || !renameValue.trim() || renameValue.trim() === cat.name) {
      setRenamingId(null);
      return;
    }
    // Use the migration API to cascade rename
    const res = await fetch("/api/categories?action=apply-migration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newCategories: categories.map((c) =>
          c.id === renamingId ? renameValue.trim() : c.name
        ),
        mappings: { [cat.name]: renameValue.trim() },
        goalActions: {},
      }),
    });
    if (res.ok) {
      toast.success(`Renamed "${cat.name}" to "${renameValue.trim()}"`);
      setRenamingId(null);
      fetchCategories();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to rename");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(categories, oldIndex, newIndex);
    setCategories(reordered);

    await fetch("/api/categories?action=reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: reordered.map((c) => c.id) }),
    });
  }

  // ── Wizard logic ──

  function startWizard() {
    setWizardCategories(
      categories.map((c) => ({
        tempId: `existing-${c.id}`,
        name: c.name,
        isNew: false,
      }))
    );
    setMappings({});
    setAiRecategorize(new Set());
    setAffectedGoals([]);
    setGoalActions({});
    setGoalReassignTargets({});
    setWizardStep("categories");
    setWizardActive(true);
  }

  function cancelWizard() {
    setWizardActive(false);
  }

  const originalNames = useMemo(
    () => categories.map((c) => c.name),
    [categories]
  );

  const wizardCategoryNames = useMemo(
    () => wizardCategories.map((c) => c.name),
    [wizardCategories]
  );

  // Categories that were removed or renamed
  const changedCategories = useMemo(() => {
    const newNames = new Set(wizardCategoryNames);
    return originalNames.filter((name) => !newNames.has(name));
  }, [originalNames, wizardCategoryNames]);

  function addWizardCategory() {
    if (!wizardNewName.trim()) return;
    if (wizardCategories.some((c) => c.name.toLowerCase() === wizardNewName.trim().toLowerCase())) {
      toast.error("Category already exists");
      return;
    }
    setWizardCategories((prev) => [
      ...prev,
      {
        tempId: `new-${Date.now()}`,
        name: wizardNewName.trim(),
        isNew: true,
      },
    ]);
    setWizardNewName("");
  }

  function removeWizardCategory(tempId: string) {
    setWizardCategories((prev) => prev.filter((c) => c.tempId !== tempId));
  }

  function startEditWizardCategory(idx: number) {
    setEditingIdx(idx);
    setEditingName(wizardCategories[idx].name);
  }

  function saveEditWizardCategory() {
    if (editingIdx === null) return;
    if (!editingName.trim()) return;
    const duplicate = wizardCategories.some(
      (c, i) => i !== editingIdx && c.name.toLowerCase() === editingName.trim().toLowerCase()
    );
    if (duplicate) {
      toast.error("Category name already exists");
      return;
    }
    setWizardCategories((prev) =>
      prev.map((c, i) => {
        if (i !== editingIdx) return c;
        const originalName = c.originalName || (!c.isNew ? c.name : undefined);
        return {
          ...c,
          name: editingName.trim(),
          originalName: editingName.trim() !== originalName ? originalName : undefined,
        };
      })
    );
    setEditingIdx(null);
    setEditingName("");
  }

  function proceedToMappings() {
    if (wizardCategories.length === 0) {
      toast.error("Add at least one category");
      return;
    }

    // Auto-fill mappings
    const autoMappings: Record<string, string> = {};
    for (const oldName of changedCategories) {
      // Check if it was renamed
      const renamed = wizardCategories.find((c) => c.originalName === oldName);
      if (renamed) {
        autoMappings[oldName] = renamed.name;
      }
    }
    setMappings(autoMappings);

    if (changedCategories.length === 0) {
      // No removals/renames — skip mapping step, check goals
      proceedToGoals();
    } else {
      setWizardStep("mappings");
    }
  }

  async function proceedToGoals() {
    setWizardLoading(true);
    // Find goals affected by changed categories
    const affectedCats = new Set(changedCategories);
    try {
      const res = await fetch("/api/goals");
      const data = await res.json();
      const goals = (data.goals || []).filter(
        (g: GoalInfo & { scope: string }) => g.scope === "category" && g.category && affectedCats.has(g.category)
      );
      setAffectedGoals(goals);

      if (goals.length === 0) {
        setWizardStep("review");
      } else {
        // Pre-fill goal actions
        const actions: Record<number, "reassign" | "delete"> = {};
        const targets: Record<number, string> = {};
        for (const goal of goals) {
          actions[goal.id] = "reassign";
          targets[goal.id] = mappings[goal.category] || wizardCategoryNames[0] || "";
        }
        setGoalActions(actions);
        setGoalReassignTargets(targets);
        setWizardStep("goals");
      }
    } catch {
      setWizardStep("review");
    } finally {
      setWizardLoading(false);
    }
  }

  // Compute summary for review step
  const migrationSummary = useMemo(() => {
    const added = wizardCategories.filter((c) => c.isNew).map((c) => c.name);
    const renamedEntries = wizardCategories.filter((c) => c.originalName);
    const renamedOriginals = new Set(renamedEntries.map((c) => c.originalName!));
    const removed = changedCategories.filter((name) => !renamedOriginals.has(name));
    const renamed = renamedEntries.map((c) => ({ from: c.originalName!, to: c.name }));

    let txAffected = 0;
    for (const oldCat of Object.keys(mappings)) {
      txAffected += categoryCounts[oldCat] || 0;
    }

    // AI re-categorize count
    let txAiRecategorize = 0;
    for (const oldCat of changedCategories) {
      if (aiRecategorize.has(oldCat)) {
        txAiRecategorize += categoryCounts[oldCat] || 0;
      }
    }

    // Unmapped transactions (categories removed without mapping and not AI)
    let txUnmapped = 0;
    for (const oldCat of changedCategories) {
      if (!mappings[oldCat] && !aiRecategorize.has(oldCat)) {
        txUnmapped += categoryCounts[oldCat] || 0;
      }
    }

    const goalsReassigned = Object.values(goalActions).filter((a) => a === "reassign").length;
    const goalsDeleted = Object.values(goalActions).filter((a) => a === "delete").length;

    return { added, removed, renamed, txAffected, txAiRecategorize, txUnmapped, goalsReassigned, goalsDeleted };
  }, [wizardCategories, changedCategories, mappings, categoryCounts, goalActions, aiRecategorize]);

  async function applyMigration() {
    setApplying(true);

    // Build goal actions with reassignment targets
    const finalGoalActions: Record<string, { action: "reassign" | "delete"; targetCategory?: string }> = {};
    for (const [goalIdStr, action] of Object.entries(goalActions)) {
      if (action === "reassign") {
        finalGoalActions[goalIdStr] = {
          action: "reassign",
          targetCategory: goalReassignTargets[parseInt(goalIdStr)] || wizardCategoryNames[0],
        };
      } else {
        finalGoalActions[goalIdStr] = { action: "delete" };
      }
    }

    try {
      const res = await fetch("/api/categories?action=apply-migration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newCategories: wizardCategoryNames,
          mappings,
          goalActions: finalGoalActions,
          recategorizeCategories: [...aiRecategorize],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Migration complete: ${data.stats?.transactionsRemapped || 0} transactions remapped, ${data.stats?.recategorized || 0} re-categorized by AI`
        );
        setWizardActive(false);
        fetchCategories();
      } else {
        toast.error(data.error || "Migration failed");
      }
    } catch {
      toast.error("Migration failed");
    }
    setApplying(false);
  }

  // ── Sortable row for main table ──
  function SortableRow({ category }: { category: Category }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: category.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const txCount = categoryCounts[category.name] || 0;
    const gCount = goalCounts[category.name] || 0;

    return (
      <TableRow ref={setNodeRef} style={style}>
        {reordering && (
          <TableCell className="w-[40px] cursor-grab" {...attributes} {...listeners}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </TableCell>
        )}
        <TableCell className="font-medium">
          {category.name}
        </TableCell>
        <TableCell className="text-right">{txCount.toLocaleString()}</TableCell>
        <TableCell className="text-right">{gCount}</TableCell>
        {!reordering && (
          <TableCell className="text-right">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(category.id)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </Button>
          </TableCell>
        )}
      </TableRow>
    );
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Categories</h2>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Wizard UI ──
  if (wizardActive) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reconfigure Categories</h2>
          <p className="text-muted-foreground">
            {wizardStep === "categories" && "Step 1: Define your new category list"}
            {wizardStep === "mappings" && "Step 2: Map old categories to new ones"}
            {wizardStep === "goals" && "Step 3: Handle affected goals"}
            {wizardStep === "review" && "Step 4: Review and apply"}
          </p>
        </div>

        {/* Step 1: Define categories */}
        {wizardStep === "categories" && (
          <Card>
            <CardHeader>
              <CardTitle>Define Categories</CardTitle>
              <CardDescription>
                Edit, add, or remove categories. Removed categories will need to be mapped in the next step.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category Name</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wizardCategories.map((cat, idx) => (
                    <TableRow
                      key={cat.tempId}
                      className={
                        cat.isNew ? "bg-green-500/10" :
                        cat.originalName ? "bg-yellow-500/10" : ""
                      }
                    >
                      <TableCell>
                        {editingIdx === idx ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditWizardCategory();
                                if (e.key === "Escape") setEditingIdx(null);
                              }}
                              className="h-8 w-[300px]"
                              autoFocus
                            />
                            <Button size="sm" variant="ghost" onClick={saveEditWizardCategory}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingIdx(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <span
                            className="cursor-pointer hover:underline"
                            onClick={() => startEditWizardCategory(idx)}
                          >
                            {cat.name}
                            {cat.isNew && <Badge variant="secondary" className="ml-2 text-xs">new</Badge>}
                            {cat.originalName && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (was: {cat.originalName})
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {cat.isNew ? "—" : (categoryCounts[cat.originalName || cat.name] || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEditWizardCategory(idx)}
                            title="Rename"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeWizardCategory(cat.tempId)}
                            title="Remove"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center gap-2">
                <Input
                  value={wizardNewName}
                  onChange={(e) => setWizardNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addWizardCategory()}
                  placeholder="New category name"
                  className="max-w-[300px]"
                />
                <Button variant="outline" onClick={addWizardCategory}>
                  Add
                </Button>
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={cancelWizard}>
                  Cancel
                </Button>
                <Button onClick={proceedToMappings} disabled={wizardLoading}>
                  {wizardLoading ? "Loading..." : "Next"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Map old → new */}
        {wizardStep === "mappings" && (
          <Card>
            <CardHeader>
              <CardTitle>Map Categories</CardTitle>
              <CardDescription>
                These categories were removed or renamed. Choose where their transactions should go.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Old Category</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead>Map To</TableHead>
                    <TableHead className="text-center">AI Decide</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changedCategories.map((oldCat) => (
                    <TableRow key={oldCat}>
                      <TableCell className="font-medium">{oldCat}</TableCell>
                      <TableCell className="text-right">
                        {(categoryCounts[oldCat] || 0).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mappings[oldCat] || ""}
                          onValueChange={(v) => {
                            setMappings((prev) => ({ ...prev, [oldCat]: v }));
                            setAiRecategorize((prev) => {
                              const next = new Set(prev);
                              next.delete(oldCat);
                              return next;
                            });
                          }}
                          disabled={aiRecategorize.has(oldCat)}
                        >
                          <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder="Select target category" />
                          </SelectTrigger>
                          <SelectContent>
                            {wizardCategoryNames.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={aiRecategorize.has(oldCat)}
                          onChange={(e) => {
                            setAiRecategorize((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) {
                                next.add(oldCat);
                                setMappings((m) => {
                                  const updated = { ...m };
                                  delete updated[oldCat];
                                  return updated;
                                });
                              } else {
                                next.delete(oldCat);
                              }
                              return next;
                            });
                          }}
                          className="rounded"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {(() => {
                const unmappedCount = changedCategories
                  .filter((c) => !mappings[c] && !aiRecategorize.has(c))
                  .reduce((sum, c) => sum + (categoryCounts[c] || 0), 0);
                return unmappedCount > 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    {unmappedCount.toLocaleString()} transaction{unmappedCount !== 1 ? "s" : ""} will be left uncategorized
                  </div>
                ) : null;
              })()}

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setWizardStep("categories")}>
                  Back
                </Button>
                <Button onClick={proceedToGoals} disabled={wizardLoading}>
                  {wizardLoading ? "Loading..." : "Next"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Handle goals */}
        {wizardStep === "goals" && (
          <Card>
            <CardHeader>
              <CardTitle>Handle Affected Goals</CardTitle>
              <CardDescription>
                These goals are scoped to categories that changed. Choose what to do with each.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Goal</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Old Category</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>New Category</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {affectedGoals.map((goal) => (
                    <TableRow key={goal.id}>
                      <TableCell className="font-medium">{goal.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {goal.type === "budget_cap" ? "Budget Cap" : goal.type === "savings_target" ? "Savings %" : "Savings $"}
                        </Badge>
                      </TableCell>
                      <TableCell>{goal.category}</TableCell>
                      <TableCell>
                        <Select
                          value={goalActions[goal.id] || "reassign"}
                          onValueChange={(v) =>
                            setGoalActions((prev) => ({
                              ...prev,
                              [goal.id]: v as "reassign" | "delete",
                            }))
                          }
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="reassign">Reassign</SelectItem>
                            <SelectItem value="delete">Delete</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {goalActions[goal.id] === "delete" ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          <Select
                            value={goalReassignTargets[goal.id] || ""}
                            onValueChange={(v) =>
                              setGoalReassignTargets((prev) => ({ ...prev, [goal.id]: v }))
                            }
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue placeholder="Pick category" />
                            </SelectTrigger>
                            <SelectContent>
                              {wizardCategoryNames.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() =>
                    setWizardStep(changedCategories.length > 0 ? "mappings" : "categories")
                  }
                >
                  Back
                </Button>
                <Button onClick={() => setWizardStep("review")}>
                  Next
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Review & Apply */}
        {wizardStep === "review" && (
          <Card>
            <CardHeader>
              <CardTitle>Review Changes</CardTitle>
              <CardDescription>
                Review the migration before applying. This action cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">New Category List</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {wizardCategoryNames.map((name) => (
                      <Badge key={name} variant="secondary">{name}</Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Summary</h4>
                  <ul className="text-sm space-y-1">
                    {migrationSummary.added.length > 0 && (
                      <li className="text-green-600">
                        + {migrationSummary.added.length} new categor{migrationSummary.added.length === 1 ? "y" : "ies"}: {migrationSummary.added.join(", ")}
                      </li>
                    )}
                    {migrationSummary.removed.length > 0 && (
                      <li className="text-red-600">
                        - {migrationSummary.removed.length} removed: {migrationSummary.removed.join(", ")}
                      </li>
                    )}
                    {migrationSummary.renamed.length > 0 && (
                      <li className="text-yellow-600">
                        ~ {migrationSummary.renamed.length} renamed: {migrationSummary.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}
                      </li>
                    )}
                    {migrationSummary.txAffected > 0 && (
                      <li>{migrationSummary.txAffected.toLocaleString()} transactions will be remapped</li>
                    )}
                    {migrationSummary.txAiRecategorize > 0 && (
                      <li>{migrationSummary.txAiRecategorize.toLocaleString()} transactions will be re-categorized by AI</li>
                    )}
                    {migrationSummary.goalsReassigned > 0 && (
                      <li>{migrationSummary.goalsReassigned} goal{migrationSummary.goalsReassigned !== 1 ? "s" : ""} reassigned</li>
                    )}
                    {migrationSummary.goalsDeleted > 0 && (
                      <li className="text-red-600">
                        {migrationSummary.goalsDeleted} goal{migrationSummary.goalsDeleted !== 1 ? "s" : ""} will be deleted
                      </li>
                    )}
                    {changedCategories.length === 0 && migrationSummary.added.length === 0 && (
                      <li className="text-muted-foreground">No changes to apply</li>
                    )}
                  </ul>
                </div>
              </div>

              {Object.keys(mappings).length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Category Mappings</h4>
                  <div className="text-sm space-y-1">
                    {Object.entries(mappings).map(([from, to]) => (
                      <div key={from} className="flex items-center gap-2">
                        <span className="text-muted-foreground line-through">{from}</span>
                        <span>→</span>
                        <span className="font-medium">{to}</span>
                        <span className="text-muted-foreground text-xs">
                          ({(categoryCounts[from] || 0).toLocaleString()} txns)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (affectedGoals.length > 0) setWizardStep("goals");
                    else if (changedCategories.length > 0) setWizardStep("mappings");
                    else setWizardStep("categories");
                  }}
                >
                  Back
                </Button>
                <Button onClick={applyMigration} disabled={applying}>
                  {applying ? "Applying..." : "Apply Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Categories</h2>
        <p className="text-muted-foreground">
          {categories.length} categories configured
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Category List</CardTitle>
          <div className="flex items-center gap-2">
            {categories.length > 1 && (
              <button
                onClick={() => setReordering((r) => !r)}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  reordering
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground border-border"
                }`}
              >
                {reordering ? "Done" : "Reorder"}
              </button>
            )}
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
              Add Category
            </Button>
            <Button size="sm" onClick={startWizard}>
              Reconfigure
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {reordering ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={categories.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Goals</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((cat) => (
                      <SortableRow key={cat.id} category={cat} />
                    ))}
                  </TableBody>
                </Table>
              </SortableContext>
            </DndContext>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Goals</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => {
                  const txCount = categoryCounts[cat.name] || 0;
                  const gCount = goalCounts[cat.name] || 0;
                  return (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium">
                        {renamingId === cat.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRename();
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="h-8 w-[250px]"
                              autoFocus
                            />
                            <Button size="sm" variant="ghost" onClick={saveRename}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <span
                            className="cursor-pointer hover:underline"
                            onClick={() => startRename(cat)}
                          >
                            {cat.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{txCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{gCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startRename(cat)}
                            title="Rename"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(cat.id)}
                            title="Delete"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Category Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="Category name"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={!newCategoryName.trim()}>
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
