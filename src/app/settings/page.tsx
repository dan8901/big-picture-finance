"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { PROVIDER_PRESETS, type ProviderKey } from "@/lib/llm-presets";

interface UsageData {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  byFeature: Array<{
    feature: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
}

interface ConfigData {
  configured: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string | null;
  model?: string;
  envFallback?: boolean;
  usage?: UsageData;
}

const PROVIDER_OPTIONS = Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({
  value: key,
  label: preset.label,
}));

export default function SettingsPage() {
  const [provider, setProvider] = useState<ProviderKey>("nvidia");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [usagePeriod, setUsagePeriod] = useState("all");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [apiKeyChanged, setApiKeyChanged] = useState(false);

  const fetchConfig = useCallback(async (period?: string) => {
    try {
      const res = await fetch(`/api/settings?usage=true&period=${period ?? usagePeriod}`);
      const data: ConfigData = await res.json();

      if (data.configured && data.provider) {
        setProvider(data.provider as ProviderKey);
        setApiKey(data.apiKey ?? "");
        setBaseUrl(data.baseUrl ?? "");
        setModel(data.model ?? "");
        setConfigured(true);
        setApiKeyChanged(false);
      }

      if (data.usage) {
        setUsage(data.usage);
      }
    } catch {
      toast.error("Failed to load settings");
    }
  }, [usagePeriod]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  function handleProviderChange(newProvider: ProviderKey) {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset.baseUrl !== null) {
      setBaseUrl(preset.baseUrl);
    } else {
      setBaseUrl("");
    }
    if (preset.models.length > 0) {
      setModel(preset.models[0]);
    } else {
      setModel("");
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: configured && !apiKeyChanged ? "__UNCHANGED__" : apiKey,
          baseUrl: provider === "anthropic" ? null : baseUrl,
          model,
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("Settings saved");
        setConfigured(true);
        setApiKeyChanged(false);
        fetchConfig();
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings?action=test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: configured && !apiKeyChanged ? "__UNCHANGED__" : apiKey,
          baseUrl: provider === "anthropic" ? null : baseUrl,
          model,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Connection successful! Response: "${data.response}"`);
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    } catch {
      toast.error("Test request failed");
    } finally {
      setTesting(false);
    }
  }

  function handlePeriodChange(period: string) {
    setUsagePeriod(period);
    fetchConfig(period);
  }

  const preset = PROVIDER_PRESETS[provider];

  const statusBadge = configured
    ? { text: "Configured", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" }
    : { text: "Not configured", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* LLM Configuration Card */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">LLM Configuration</h2>
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusBadge.color}`}>
            {statusBadge.text}
          </span>
        </div>

        <div className="grid gap-4">
          {/* Provider */}
          <div>
            <label className="text-sm font-medium mb-1 block">Provider</label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as ProviderKey)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="text-sm font-medium mb-1 block">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setApiKeyChanged(true); }}
              placeholder="Enter API key"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="text-sm font-medium mb-1 block">Base URL</label>
            <input
              type="text"
              value={provider === "anthropic" ? "(native Anthropic SDK)" : baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={provider === "anthropic"}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>

          {/* Model */}
          <div>
            <label className="text-sm font-medium mb-1 block">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="model-suggestions"
              placeholder="Enter model name"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <datalist id="model-suggestions">
              {preset.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleTest}
            disabled={testing || (!apiKey && !configured)}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (!apiKey && !configured) || !model}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Usage & Cost Card */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">API Usage & Cost</h2>
          <select
            value={usagePeriod}
            onChange={(e) => handlePeriodChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        {usage ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">API Calls</div>
                <div className="text-xl font-bold">{Number(usage.totalCalls).toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Input Tokens</div>
                <div className="text-xl font-bold">{Number(usage.totalInputTokens).toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Output Tokens</div>
                <div className="text-xl font-bold">{Number(usage.totalOutputTokens).toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Estimated Cost</div>
                <div className="text-xl font-bold">${Number(usage.totalCost).toFixed(4)}</div>
              </div>
            </div>

            {usage.byFeature.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">By Feature</h3>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Feature</th>
                        <th className="text-right px-3 py-2 font-medium">Calls</th>
                        <th className="text-right px-3 py-2 font-medium">Input</th>
                        <th className="text-right px-3 py-2 font-medium">Output</th>
                        <th className="text-right px-3 py-2 font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byFeature.map((f) => (
                        <tr key={f.feature} className="border-t">
                          <td className="px-3 py-2 capitalize">{f.feature}</td>
                          <td className="text-right px-3 py-2">{Number(f.calls).toLocaleString()}</td>
                          <td className="text-right px-3 py-2">{Number(f.inputTokens).toLocaleString()}</td>
                          <td className="text-right px-3 py-2">{Number(f.outputTokens).toLocaleString()}</td>
                          <td className="text-right px-3 py-2">${Number(f.cost).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
        )}
      </div>
    </div>
  );
}
