'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StockItem } from '@/lib/types';
import { getBuiltInConsolidations } from '@/lib/consolidation';
import { formatNumber, formatRupees } from '@/lib/format';
import { Save, Search, Lock, ArrowRight } from 'lucide-react';

interface ConsolidationManagerProps {
  items: StockItem[];
  consolidations: Record<string, string>;
  onSave: (consolidations: Record<string, string>) => Promise<void>;
}

interface PublisherRow {
  publisher: string;
  itemCount: number;
  revenue: number;
  currentParent: string | null;
  isBuiltIn: boolean;
}

export function ConsolidationManager({
  items,
  consolidations,
  onSave,
}: ConsolidationManagerProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({ ...consolidations });
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const builtInConsolidations = useMemo(() => getBuiltInConsolidations(), []);

  // Build publisher rows from actual data
  const publisherRows: PublisherRow[] = useMemo(() => {
    const pubMap = new Map<string, { count: number; revenue: number }>();
    for (const item of items) {
      if (item.publisher === 'Unknown Publisher') continue;
      const existing = pubMap.get(item.publisher) || { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += item.revenue;
      pubMap.set(item.publisher, existing);
    }

    return Array.from(pubMap.entries())
      .map(([publisher, stats]) => ({
        publisher,
        itemCount: stats.count,
        revenue: stats.revenue,
        currentParent: builtInConsolidations[publisher] || consolidations[publisher] || null,
        isBuiltIn: publisher in builtInConsolidations,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items, consolidations, builtInConsolidations]);

  // All unique parent publisher names (for autocomplete)
  const parentPublishers = useMemo(() => {
    const parents = new Set<string>();
    for (const row of publisherRows) {
      if (row.currentParent) parents.add(row.currentParent);
      parents.add(row.publisher); // any publisher can be a parent
    }
    return Array.from(parents).sort();
  }, [publisherRows]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return publisherRows;
    const q = searchQuery.toLowerCase();
    return publisherRows.filter(r =>
      r.publisher.toLowerCase().includes(q) ||
      (r.currentParent && r.currentParent.toLowerCase().includes(q))
    );
  }, [publisherRows, searchQuery]);

  const hasUnsavedChanges = useMemo(() => {
    const draftKeys = Object.keys(drafts);
    const consolKeys = Object.keys(consolidations);
    if (draftKeys.length !== consolKeys.length) return true;
    for (const [key, value] of Object.entries(drafts)) {
      if ((consolidations[key] || '') !== (value || '')) return true;
    }
    for (const key of consolKeys) {
      if (!(key in drafts)) return true;
    }
    return false;
  }, [drafts, consolidations]);

  async function handleSave() {
    setSaving(true);
    // Clean empty values
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(drafts)) {
      if (value.trim()) {
        cleaned[key] = value.trim();
      }
    }
    await onSave(cleaned);
    setSaving(false);
  }

  const consolidatedCount = publisherRows.filter(r => r.currentParent && !r.isBuiltIn).length;
  const builtInCount = publisherRows.filter(r => r.isBuiltIn).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          Consolidate Imprints
          <Badge variant="secondary">{publisherRows.length} publishers</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Group imprints under their parent publisher (e.g., Fourth Estate → HarperCollins).{' '}
          {builtInCount > 0 && (
            <span>{builtInCount} built-in, </span>
          )}
          {consolidatedCount > 0 && (
            <span className="text-green-600 font-medium">{consolidatedCount} custom</span>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search publishers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasUnsavedChanges || saving}
          >
            <Save className="h-4 w-4 mr-1" />
            {saving ? 'Reprocessing...' : 'Save & Reprocess'}
          </Button>
        </div>

        {hasUnsavedChanges && (
          <p className="text-sm text-amber-600">You have unsaved changes</p>
        )}

        <datalist id="parent-publishers-list">
          {parentPublishers.map(p => (
            <option key={p} value={p} />
          ))}
        </datalist>

        <div className="max-h-[500px] overflow-auto border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[200px]">Publisher / Imprint</TableHead>
                <TableHead className="text-right w-[70px]">Items</TableHead>
                <TableHead className="text-right w-[90px]">Revenue</TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-[200px]">Parent Publisher</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => {
                const isBuiltIn = row.isBuiltIn;
                const draft = isBuiltIn
                  ? builtInConsolidations[row.publisher]
                  : (drafts[row.publisher] || '');

                return (
                  <TableRow key={row.publisher} className={isBuiltIn ? 'opacity-60' : ''}>
                    <TableCell className="text-sm font-medium">{row.publisher}</TableCell>
                    <TableCell className="text-right text-sm">{formatNumber(row.itemCount)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {row.revenue > 0 ? formatRupees(row.revenue) : '—'}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      {isBuiltIn ? (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Lock className="h-3 w-3" />
                          {draft}
                        </div>
                      ) : (
                        <input
                          type="text"
                          list="parent-publishers-list"
                          value={draft}
                          onChange={(e) =>
                            setDrafts(prev => ({ ...prev, [row.publisher]: e.target.value }))
                          }
                          placeholder="Assign parent..."
                          className="w-full text-sm border rounded px-2 py-1 bg-background"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
