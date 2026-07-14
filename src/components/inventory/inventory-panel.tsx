"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchDatasetInventory } from "@/lib/actions/inventory";
import type { DatasetInventory } from "@/lib/worker/client";
import type { Dataset } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ClipboardList, RefreshCw } from "lucide-react";

interface InventoryPanelProps {
  projectId: string;
  datasets: Dataset[];
  defaultDatasetId?: string;
}

export function InventoryPanel({
  projectId,
  datasets,
  defaultDatasetId,
}: InventoryPanelProps) {
  const initial =
    defaultDatasetId && datasets.some((d) => d.id === defaultDatasetId)
      ? defaultDatasetId
      : datasets[0]?.id ?? "";
  const [datasetId, setDatasetId] = useState(initial);
  const [data, setData] = useState<DatasetInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  async function load(id: string) {
    if (!id) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchDatasetInventory(projectId, id);
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load(datasetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, datasetId]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.images;
    return data.images.filter((img) => {
      if (img.file_name.toLowerCase().includes(q)) return true;
      return Object.keys(img.class_counts).some((name) =>
        name.toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  const datasetName = datasets.find((d) => d.id === datasetId)?.name ?? "dataset";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Stock check"
          description="Labeled / reviewed images — per-image product counts (Pepsi 250ml, 7up, …)."
          action={
            <Button
              type="button"
              variant="secondary"
              loading={loading}
              onClick={() => void load(datasetId)}
              disabled={!datasetId || loading}
            >
              {!loading && <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <div className="flex flex-wrap items-end gap-4">
          <label className="block min-w-[220px] flex-1 text-sm">
            <span className="mb-1 block text-slate-600">Dataset</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              disabled={datasets.length === 0}
            >
              {datasets.length === 0 && <option value="">No datasets</option>}
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[200px] flex-1 text-sm">
            <span className="mb-1 block text-slate-600">Search image / class</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g. pepsi 250 or IMG_01"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <div className="mt-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!error && !loading && data && data.labeled_count === 0 && (
          <div className="mt-4">
            <Alert variant="info">
              No labeled images in <strong>{datasetName}</strong> yet. Run auto-label /
              review first, then refresh.
            </Alert>
          </div>
        )}
      </Card>

      {data && data.labeled_count > 0 && (
        <>
          <Card>
            <CardHeader title="Dataset totals" description={`${data.labeled_count} labeled image(s) · ${data.total_objects} objects`} />
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.class_totals).map(([name, count]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-800"
                >
                  <span className="font-medium">{name}</span>
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {count}
                  </span>
                </span>
              ))}
              {Object.keys(data.class_totals).length === 0 && (
                <p className="text-sm text-slate-500">
                  Images are marked labeled but have 0 detection objects.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Per image"
              description={`Showing ${filtered.length} of ${data.labeled_count} labeled image(s)`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 font-semibold">Image</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Total</th>
                    <th className="px-2 py-2 font-semibold">Class counts</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((img) => (
                    <tr
                      key={img.image_id}
                      className="border-b border-slate-100 align-top hover:bg-slate-50/80"
                    >
                      <td className="px-2 py-3 font-medium text-slate-900">
                        {img.file_name}
                      </td>
                      <td className="px-2 py-3 text-slate-600">
                        {img.review_status || img.status}
                      </td>
                      <td className="px-2 py-3 font-semibold text-slate-900">
                        {img.total_objects}
                      </td>
                      <td className="px-2 py-3">
                        {Object.keys(img.class_counts).length === 0 ? (
                          <span className="text-slate-400">No objects</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(img.class_counts).map(([name, count]) => (
                              <span
                                key={`${img.image_id}-${name}`}
                                className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-900"
                              >
                                {name}: <strong>{count}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {loading && !data && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <ClipboardList className="h-4 w-4" />
            Loading inventory…
          </div>
        </Card>
      )}
    </div>
  );
}
