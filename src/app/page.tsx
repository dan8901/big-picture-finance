"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

interface DashboardData {
  totalIncome: number;
  totalExpenses: number;
  totalSaved: number;
  savingsRate: number;
  totalIncomeILS: number;
  totalExpensesILS: number;
  totalSavedILS: number;
  weightedExchangeRate: number;
  expensesByCategory: Record<string, number>;
  expensesByCategoryILS: Record<string, number>;
  expensesByOwner: Record<string, number>;
  incomeBySource: Record<string, number>;
  incomeBySourceILS: Record<string, number>;
  incomeByOwner: Record<string, number>;
  eventExpenses: Record<string, number>;
  eventExpensesILS: Record<string, number>;
  normalExpenses: number;
  normalExpensesILS: number;
  recurringExpenses: number;
  nonRecurringExpenses: number;
  monthlyTrend: Array<{
    month: string;
    income: number;
    expenses: number;
    recurring: number;
    nonRecurring: number;
    incomeILS: number;
    expensesILS: number;
  }>;
  topMerchantsByCategory: Record<string, Array<MerchantData>>;
  merchantCountByCategory: Record<string, number>;
  txCountByCategory: Record<string, number>;
  recurringByCategory: Record<string, number>;
  nonRecurringByCategory: Record<string, number>;
  recurringMerchants: MerchantData[];
  nonRecurringTopMerchants: MerchantData[];
  eventDetails: Array<{
    id: number;
    name: string;
    type: string;
    startDate: string;
    endDate: string | null;
    totalUsd: number;
    totalIls: number;
    txCount: number;
  }>;
  topExpenseTransactions: Array<{
    date: string;
    description: string;
    amount: number;
    currency: string;
    usdAmount: number;
    category: string;
    owner: string;
  }>;
}

interface MerchantData {
  name: string;
  usd: number;
  ils: number;
  count: number;
  avgUsd: number;
  isRecurring: boolean;
  category: string;
}

const COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea",
  "#0891b2", "#e11d48", "#65a30d", "#d97706", "#7c3aed",
  "#0d9488", "#f43f5e", "#84cc16", "#f59e0b", "#8b5cf6",
];

function formatILS(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function DashboardPage() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const lastDayPrevMonth = (() => {
    const d = new Date();
    d.setDate(0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(lastDayPrevMonth);
  const [data, setData] = useState<DashboardData | null>(null);
  const [prevData, setPrevData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate, endDate });
    const res = await fetch(`/api/dashboard?${params}`);
    setData(await res.json());

    // Fetch previous year for comparison
    const prevStart = startDate.replace(/^\d{4}/, String(parseInt(startDate) - 1));
    const prevEnd = endDate.replace(/^\d{4}/, String(parseInt(endDate) - 1));
    const prevParams = new URLSearchParams({ startDate: prevStart, endDate: prevEnd });
    const prevRes = await fetch(`/api/dashboard?${prevParams}`);
    const prevJson = await prevRes.json();
    // Only set if there's actual data
    if (prevJson.totalIncome > 0 || prevJson.totalExpenses > 0) {
      setPrevData(prevJson);
    } else {
      setPrevData(null);
    }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const effectiveEnd = new Date(Math.min(new Date(endDate).getTime(), Date.now()));
  const dayCount = Math.max(
    1,
    (effectiveEnd.getTime() - new Date(startDate).getTime()) /
      (1000 * 60 * 60 * 24) +
      1
  );
  const monthCount = dayCount / 30.44;

  function drillDown(category: string) {
    const params = new URLSearchParams({ category, startDate, endDate });
    router.push(`/transactions?${params}`);
  }

  const categoryData = data
    ? Object.entries(data.expensesByCategory)
        .map(([name, value]) => ({
          name,
          value,
          ilsValue: data.expensesByCategoryILS[name] ?? 0,
        }))
        .sort((a, b) => b.value - a.value)
    : [];

  const ownerData = data
    ? Object.entries(data.expensesByOwner).map(([name, value]) => ({
        name,
        value,
      }))
    : [];

  const eventTotal = data
    ? Object.values(data.eventExpenses).reduce((sum, v) => sum + v, 0)
    : 0;

  const hasData = data && (data.totalIncome > 0 || data.totalExpenses > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Your financial overview ({monthCount.toFixed(1)} months)
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex gap-1 items-end">
            <Button
              variant={startDate === "2024-10-01" && endDate === lastDayPrevMonth ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStartDate("2024-10-01");
                setEndDate(lastDayPrevMonth);
              }}
            >
              All
            </Button>
            <Button
              variant={startDate === "2025-01-01" && endDate === "2025-12-31" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStartDate("2025-01-01");
                setEndDate("2025-12-31");
              }}
            >
              2025
            </Button>
            <Button
              variant={
                startDate === `${currentYear}-01-01` &&
                endDate === lastDayPrevMonth
                  ? "default"
                  : "outline"
              }
              size="sm"
              onClick={() => {
                setStartDate(`${currentYear}-01-01`);
                setEndDate(lastDayPrevMonth);
              }}
            >
              YTD
            </Button>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full sm:w-[160px]"
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <>
                <Skeleton className="h-8 w-[120px]" />
                <Skeleton className="h-5 w-[80px] mt-1" />
              </>
            ) : (
              <>
                <div className="text-xl sm:text-2xl font-bold text-green-600">
                  {data ? formatAmount(data.totalIncome) : "--"}
                  {data && data.weightedExchangeRate > 0 && (
                    <span className="text-lg"> / {formatILS(data.totalIncome / data.weightedExchangeRate)}</span>
                  )}
                </div>
                {data && data.weightedExchangeRate > 0 && (
                  <p className="text-lg text-green-600">
                    {formatILS(data.totalIncome / data.weightedExchangeRate / monthCount)}/mo
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <>
                <Skeleton className="h-8 w-[120px]" />
                <Skeleton className="h-5 w-[80px] mt-1" />
              </>
            ) : (
              <>
                <div className="text-xl sm:text-2xl font-bold text-red-600">
                  {data ? formatAmount(data.totalExpenses) : "--"}
                  {data && data.weightedExchangeRate > 0 && (
                    <span className="text-lg"> / {formatILS(data.totalExpenses / data.weightedExchangeRate)}</span>
                  )}
                </div>
                {data && data.weightedExchangeRate > 0 && (
                  <p className="text-lg text-red-600">
                    {formatILS(data.totalExpenses / data.weightedExchangeRate / monthCount)}/mo
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Saved</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <>
                <Skeleton className="h-8 w-[120px]" />
                <Skeleton className="h-5 w-[80px] mt-1" />
              </>
            ) : (
              <>
                <div
                  className={`text-2xl font-bold ${data && data.totalSaved >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {data ? formatAmount(data.totalSaved) : "--"}
                  {data && data.weightedExchangeRate > 0 && (
                    <span className="text-lg"> / {formatILS(data.totalSaved / data.weightedExchangeRate)}</span>
                  )}
                </div>
                {data && data.weightedExchangeRate > 0 && (
                  <p className={`text-lg ${data && data.totalSaved >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatILS(data.totalSaved / data.weightedExchangeRate / monthCount)}/mo
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Savings Rate</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <>
                <Skeleton className="h-8 w-[120px]" />
                <Skeleton className="h-5 w-[80px] mt-1" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {data ? `${data.savingsRate.toFixed(1)}%` : "--"}
                </div>
                {data && data.weightedExchangeRate > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Avg rate: $1 = {(1 / data.weightedExchangeRate).toFixed(2)} ILS
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex h-[300px] items-center justify-center text-muted-foreground">
            No data yet. Upload reports and add income entries to see your
            financial overview.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Income Breakdown */}
          {data && Object.keys(data.incomeBySource).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Income Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                      <TableHead className="text-right">Amount (ILS)</TableHead>
                      <TableHead className="text-right">Per Month (ILS)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(data.incomeBySource)
                      .sort(([, a], [, b]) => b - a)
                      .map(([source, amount]) => {
                        const sourceLabels: Record<string, string> = {
                          salary: "Salary",
                          rsu: "RSUs",
                          espp: "ESPP",
                          pension: "Pension",
                          keren_hishtalmut: "Keren Hishtalmut",
                          deposits: "Bank Deposits",
                          other: "Other",
                        };
                        const ilsAmount = data.weightedExchangeRate > 0
                          ? amount / data.weightedExchangeRate
                          : 0;
                        return (
                          <TableRow key={source}>
                            <TableCell className="font-medium">
                              {sourceLabels[source] ?? source}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatAmount(amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {ilsAmount > 0 ? formatILS(ilsAmount) : "--"}
                            </TableCell>
                            <TableCell className="text-right">
                              {ilsAmount > 0
                                ? formatILS(ilsAmount / monthCount)
                                : "--"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        {formatAmount(data.totalIncome)}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0
                          ? formatILS(data.totalIncome / data.weightedExchangeRate)
                          : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0
                          ? formatILS(
                              data.totalIncome /
                                data.weightedExchangeRate /
                                monthCount
                            )
                          : "--"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Expense Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Expense Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] md:h-[500px]">
              {categoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={120}
                      dataKey="value"
                      paddingAngle={2}
                      label={({ name, percent }) =>
                        `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                      }
                      className="cursor-pointer"
                      onClick={(_: unknown, index: number) => drillDown(categoryData[index].name)}
                    >
                      {categoryData.map((_, index) => (
                        <Cell
                          key={index}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, _name, props) => {
                        const ils = props.payload?.ilsValue;
                        const usd = formatAmount(Number(value));
                        return ils ? `${usd} (${formatILS(ils)})` : usd;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No categorized expenses
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Merchants by Category */}
          {data && categoryData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Merchants by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Total (USD)</TableHead>
                      <TableHead className="text-right">Total (ILS)</TableHead>
                      <TableHead className="text-right">Per Month (ILS)</TableHead>
                      <TableHead className="text-right"># Txns</TableHead>
                      <TableHead className="text-right">Avg (ILS)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryData.map((cat) => {
                      const ilsTotal = data.weightedExchangeRate > 0
                        ? cat.value / data.weightedExchangeRate
                        : 0;
                      return (
                        <Fragment key={cat.name}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() =>
                              setExpandedCategory(
                                expandedCategory === cat.name ? null : cat.name
                              )
                            }
                          >
                            <TableCell className="font-medium">
                              {expandedCategory === cat.name ? "\u25BC" : "\u25B6"}{" "}
                              {cat.name}
                              <span className="ml-2 text-xs text-muted-foreground font-normal">
                                ({data.merchantCountByCategory[cat.name] ?? 0} merchants)
                              </span>
                              <button
                                className="ml-2 text-xs text-blue-600 hover:underline font-normal"
                                onClick={(e) => { e.stopPropagation(); drillDown(cat.name); }}
                              >
                                View txns
                              </button>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatAmount(cat.value)}
                            </TableCell>
                            <TableCell className="text-right">
                              {ilsTotal > 0 ? formatILS(ilsTotal) : "--"}
                            </TableCell>
                            <TableCell className="text-right">
                              {ilsTotal > 0
                                ? formatILS(ilsTotal / monthCount)
                                : "--"}
                            </TableCell>
                            <TableCell className="text-right">
                              {data.txCountByCategory[cat.name] ?? 0}
                            </TableCell>
                            <TableCell className="text-right">
                              {ilsTotal > 0 && (data.txCountByCategory[cat.name] ?? 0) > 0
                                ? formatILS(ilsTotal / data.txCountByCategory[cat.name])
                                : "--"}
                            </TableCell>
                          </TableRow>
                          {expandedCategory === cat.name &&
                            data.topMerchantsByCategory[cat.name]?.map((m) => (
                              <TableRow key={m.name} className="bg-muted/30">
                                <TableCell className="pl-10 text-sm text-muted-foreground max-w-[200px] truncate" title={m.name}>
                                  {m.name}
                                  {m.isRecurring && (
                                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">recurring</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {formatAmount(m.usd)}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {m.ils > 0 ? formatILS(m.ils) : formatILS(m.usd / data.weightedExchangeRate)}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {m.ils > 0
                                    ? formatILS(m.ils / monthCount)
                                    : formatILS(m.usd / data.weightedExchangeRate / monthCount)}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {m.count}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {m.ils > 0
                                    ? formatILS(m.ils / m.count)
                                    : data.weightedExchangeRate > 0
                                      ? formatILS(m.avgUsd / data.weightedExchangeRate)
                                      : "--"}
                                </TableCell>
                              </TableRow>
                            ))}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recurring vs Non-Recurring by Category */}
          {data && (
            <Card>
              <CardHeader>
                <CardTitle>Recurring vs Non-Recurring by Category</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px] md:h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      ...categoryData.map((cat) => ({
                        name: cat.name,
                        recurring: data.recurringByCategory[cat.name] ?? 0,
                        nonRecurring: data.nonRecurringByCategory[cat.name] ?? 0,
                      })),
                      {
                        name: "Events/Trips",
                        recurring: 0,
                        nonRecurring: eventTotal,
                      },
                    ]}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => formatAmount(v)} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => {
                        const v = Number(value);
                        const usd = formatAmount(v);
                        return data.weightedExchangeRate > 0
                          ? `${usd} (${formatILS(v / data.weightedExchangeRate)})`
                          : usd;
                      }}
                    />
                    <Legend />
                    <Bar dataKey="recurring" stackId="a" fill="#2563eb" name="Recurring" />
                    <Bar dataKey="nonRecurring" stackId="a" fill="#94a3b8" name="Non-recurring" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Recurring Expenses */}
          {data && data.recurringMerchants.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recurring Expenses</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[500px] overflow-y-auto">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Total (USD)</TableHead>
                      <TableHead className="text-right">Total (ILS)</TableHead>
                      <TableHead className="text-right">Per Month (ILS)</TableHead>
                      <TableHead className="text-right"># Txns</TableHead>
                      <TableHead className="text-right">Avg (ILS)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recurringMerchants.map((m) => {
                      const ilsVal = m.ils > 0 ? m.ils : (data.weightedExchangeRate > 0 ? m.usd / data.weightedExchangeRate : 0);
                      return (
                        <TableRow key={`${m.category}-${m.name}`}>
                          <TableCell className="max-w-[200px] truncate" title={m.name}>{m.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{m.category}</TableCell>
                          <TableCell className="text-right">{formatAmount(m.usd)}</TableCell>
                          <TableCell className="text-right">{formatILS(ilsVal)}</TableCell>
                          <TableCell className="text-right">{formatILS(ilsVal / monthCount)}</TableCell>
                          <TableCell className="text-right">{m.count}</TableCell>
                          <TableCell className="text-right">{formatILS(ilsVal / m.count)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right">{formatAmount(data.recurringExpenses)}</TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0 ? formatILS(data.recurringExpenses / data.weightedExchangeRate) : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0 ? formatILS(data.recurringExpenses / data.weightedExchangeRate / monthCount) : "--"}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Non-Recurring Expenses */}
          {data && data.nonRecurringTopMerchants.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Non-Recurring Expenses</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[500px] overflow-y-auto">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Total (USD)</TableHead>
                      <TableHead className="text-right">Total (ILS)</TableHead>
                      <TableHead className="text-right">Per Month (ILS)</TableHead>
                      <TableHead className="text-right"># Txns</TableHead>
                      <TableHead className="text-right">Avg (ILS)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.nonRecurringTopMerchants.map((m) => {
                      const ilsVal = m.ils > 0 ? m.ils : (data.weightedExchangeRate > 0 ? m.usd / data.weightedExchangeRate : 0);
                      return (
                        <TableRow key={`${m.category}-${m.name}`}>
                          <TableCell className="max-w-[200px] truncate" title={m.name}>{m.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{m.category}</TableCell>
                          <TableCell className="text-right">{formatAmount(m.usd)}</TableCell>
                          <TableCell className="text-right">{formatILS(ilsVal)}</TableCell>
                          <TableCell className="text-right">{formatILS(ilsVal / monthCount)}</TableCell>
                          <TableCell className="text-right">{m.count}</TableCell>
                          <TableCell className="text-right">{formatILS(ilsVal / m.count)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right">{formatAmount(data.nonRecurringExpenses)}</TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0 ? formatILS(data.nonRecurringExpenses / data.weightedExchangeRate) : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0 ? formatILS(data.nonRecurringExpenses / data.weightedExchangeRate / monthCount) : "--"}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Monthly Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Trends</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px] md:h-[350px]">
              {data && data.monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.monthlyTrend.map((m) => ({ ...m, savings: m.income - m.expenses }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="usd" />
                    <YAxis yAxisId="ils" orientation="right" />
                    <Tooltip
                      formatter={(value, name, props) => {
                        const v = Number(value);
                        if (
                          name === "Income (ILS)" ||
                          name === "Expenses (ILS)"
                        )
                          return formatILS(v);
                        return formatAmount(v);
                      }}
                      labelFormatter={(label, payload) => {
                        if (!payload || payload.length === 0) return label;
                        const d = payload[0]?.payload;
                        const totalILS = (d?.incomeILS ?? 0) + (d?.expensesILS ?? 0);
                        const usdFromILS = d?.usdFromILS ?? 0;
                        if (totalILS > 0 && usdFromILS > 0) {
                          const rate = totalILS / usdFromILS;
                          return `${label}  ($1 = ${rate.toFixed(2)} ILS)`;
                        }
                        return label;
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="usd"
                      type="monotone"
                      dataKey="income"
                      stroke="#16a34a"
                      strokeWidth={2}
                      name="Income"
                    />
                    <Line
                      yAxisId="usd"
                      type="monotone"
                      dataKey="expenses"
                      stroke="#dc2626"
                      strokeWidth={2}
                      name="Expenses"
                    />
                    <Line
                      yAxisId="usd"
                      type="monotone"
                      dataKey="recurring"
                      stroke="#2563eb"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      name="Recurring"
                    />
                    <Line
                      yAxisId="usd"
                      type="monotone"
                      dataKey="nonRecurring"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      name="Non-recurring"
                    />
                    <Line
                      yAxisId="usd"
                      type="monotone"
                      dataKey="savings"
                      stroke="#9333ea"
                      strokeWidth={2}
                      name="Savings"
                    />
                    <Line
                      yAxisId="ils"
                      type="monotone"
                      dataKey="incomeILS"
                      stroke="#16a34a"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="Income (ILS)"
                    />
                    <Line
                      yAxisId="ils"
                      type="monotone"
                      dataKey="expensesILS"
                      stroke="#dc2626"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="Expenses (ILS)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No monthly data
                </div>
              )}
            </CardContent>
          </Card>

          {/* Year-over-Year Comparison */}
          {data && prevData && (
            <Card>
              <CardHeader>
                <CardTitle>Year-over-Year Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Previous Year</TableHead>
                      <TableHead className="text-right">Current Year</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Summary rows first */}
                    {[
                      { label: "Total Income", curr: data.totalIncome, prev: prevData.totalIncome, green: true },
                      { label: "Total Expenses", curr: data.totalExpenses, prev: prevData.totalExpenses, green: false },
                      { label: "Total Saved", curr: data.totalSaved, prev: prevData.totalSaved, green: true },
                    ].map((row) => {
                      const delta = row.prev > 0 ? ((row.curr - row.prev) / row.prev) * 100 : 0;
                      const isGood = row.green ? delta > 0 : delta < 0;
                      return (
                        <TableRow key={row.label} className="font-bold border-b-2">
                          <TableCell>{row.label}</TableCell>
                          <TableCell className="text-right">{formatAmount(row.prev)}</TableCell>
                          <TableCell className="text-right">{formatAmount(row.curr)}</TableCell>
                          <TableCell className={`text-right ${isGood ? "text-green-600" : delta !== 0 ? "text-red-600" : ""}`}>
                            {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Category breakdown */}
                    {(() => {
                      const allCategories = [...new Set([
                        ...Object.keys(data.expensesByCategory),
                        ...Object.keys(prevData.expensesByCategory),
                      ])].sort((a, b) => (data.expensesByCategory[b] ?? 0) - (data.expensesByCategory[a] ?? 0));
                      return allCategories.map((cat) => {
                        const curr = data.expensesByCategory[cat] ?? 0;
                        const prev = prevData.expensesByCategory[cat] ?? 0;
                        const delta = prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;
                        return (
                          <TableRow key={cat}>
                            <TableCell className="pl-6 text-muted-foreground">{cat}</TableCell>
                            <TableCell className="text-right">{formatAmount(prev)}</TableCell>
                            <TableCell className="text-right">{formatAmount(curr)}</TableCell>
                            <TableCell className={`text-right ${delta < 0 ? "text-green-600" : delta > 0 ? "text-red-600" : ""}`}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Events/Trips Breakdown */}
          {data && data.eventDetails && data.eventDetails.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Events & Trips Spending</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead className="text-right">Total (USD)</TableHead>
                      <TableHead className="text-right">Total (ILS)</TableHead>
                      <TableHead className="text-right"># Txns</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eventDetails.map((evt) => {
                      const ilsTotal = evt.totalIls > 0
                        ? evt.totalIls
                        : data.weightedExchangeRate > 0
                          ? evt.totalUsd / data.weightedExchangeRate
                          : 0;
                      return (
                        <TableRow key={evt.id}>
                          <TableCell className="font-medium">{evt.name}</TableCell>
                          <TableCell className="text-muted-foreground capitalize">{evt.type.replace("_", " ")}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {evt.startDate}{evt.endDate ? ` — ${evt.endDate}` : ""}
                          </TableCell>
                          <TableCell className="text-right">{formatAmount(evt.totalUsd)}</TableCell>
                          <TableCell className="text-right">{ilsTotal > 0 ? formatILS(ilsTotal) : "--"}</TableCell>
                          <TableCell className="text-right">{evt.txCount}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right">
                        {formatAmount(data.eventDetails.reduce((s, e) => s + e.totalUsd, 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.weightedExchangeRate > 0
                          ? formatILS(data.eventDetails.reduce((s, e) => s + e.totalUsd, 0) / data.weightedExchangeRate)
                          : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.eventDetails.reduce((s, e) => s + e.txCount, 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top One-Time Expenses */}
          {data && data.topExpenseTransactions && data.topExpenseTransactions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Largest One-Time Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topExpenseTransactions.map((tx, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{tx.date}</TableCell>
                        <TableCell className="max-w-[250px] truncate" title={tx.description}>
                          {tx.description}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{tx.category}</TableCell>
                        <TableCell className="text-muted-foreground">{tx.owner}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-red-600">
                          {tx.currency === "ILS" ? "\u20AA" : "$"}
                          {Math.abs(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          {tx.currency === "ILS" && data.weightedExchangeRate > 0 && (
                            <span className="text-muted-foreground text-xs ml-1">
                              ({formatAmount(tx.usdAmount)})
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-person Breakdown */}
          {ownerData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Expenses by Person</CardTitle>
              </CardHeader>
              <CardContent className="h-[250px] md:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ownerData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip
                      formatter={(value) => formatAmount(Number(value))}
                    />
                    <Bar dataKey="value" fill="#9333ea" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
