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
import { UnknownBrandGroup } from '@/lib/types';
import { getKnownPublishers } from '@/lib/publisher-cleaner';
import { formatNumber, formatRupees } from '@/lib/format';
import { Save, Download, CheckCircle2, Search, Layers } from 'lucide-react';

const PAGE_SIZE = 50;

interface PublisherCleanupProps {
  groups: UnknownBrandGroup[];
  userMappings: Record<string, string>;
  onReprocess: (mappings: Record<string, string>) => Promise<void>;
}

export function PublisherCleanup({ groups, userMappings, onReprocess }: PublisherCleanupProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const g of groups) {
      if (userMappings[g.rawBrand]) {
        initial[g.rawBrand] = userMappings[g.rawBrand];
      }
    }
    return initial;
  });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkPublisher, setBulkPublisher] = useState('');

  const knownPublishers = useMemo(() => getKnownPublishers(), []);
  const datalistId = 'known-publishers-list';

  const hasUnsavedChanges = useMemo(() => {
    for (const [brand, value] of Object.entries(drafts)) {
      const saved = userMappings[brand] || '';
      if (value.trim() !== saved.trim()) return true;
    }
    return false;
  }, [drafts, userMappings]);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(g =>
      g.rawBrand.toLowerCase().includes(q) ||
      g.sampleTitles.some(t => t.toLowerCase().includes(q)) ||
      g.subBrands.some(sb => sb.toLowerCase().includes(q))
    );
  }, [groups, searchQuery]);

  const visibleGroups = filteredGroups.slice(0, visibleCount);

  // Stats
  const mappedCount = Object.values(userMappings).filter(v => v.trim()).length;
  const totalItems = groups.reduce((sum, g) => sum + g.itemCount, 0);
  const totalRevenue = groups.reduce((sum, g) => sum + g.totalRevenue, 0);

  // Count unmapped groups that have no draft either
  const unmappedGroups = filteredGroups.filter(
    g => !userMappings[g.rawBrand]?.trim() && !drafts[g.rawBrand]?.trim()
  );

  async function handleSave() {
    setSaving(true);
    const merged = { ...userMappings };
    for (const [brand, value] of Object.entries(drafts)) {
      if (value.trim()) {
        merged[brand] = value.trim();
      } else {
        delete merged[brand];
      }
    }
    await onReprocess(merged);
    setSaving(false);
  }

  function handleBulkAssign() {
    if (!bulkPublisher.trim()) return;
    const newDrafts = { ...drafts };
    for (const g of unmappedGroups) {
      newDrafts[g.rawBrand] = bulkPublisher.trim();
    }
    setDrafts(newDrafts);
    setBulkPublisher('');
  }

  function handleExport() {
    const allMappings = { ...userMappings, ...drafts };
    const rows = [['Raw Brand', 'Mapped Publisher']];
    for (const [brand, publisher] of Object.entries(allMappings)) {
      if (publisher.trim()) {
        rows.push([brand, publisher.trim()]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'publisher-mappings.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          Fix Unknown Publishers
          <Badge variant="secondary">{groups.length} brands</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatNumber(totalItems)} items, {formatRupees(totalRevenue)} revenue affected.
          {mappedCount > 0 && (
            <span className="text-green-600 font-medium"> ({mappedCount} already mapped)</span>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search + Actions */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search brands, titles, sub-brands..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
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
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>

        {hasUnsavedChanges && (
          <p className="text-sm text-amber-600">You have unsaved changes</p>
        )}

        {/* Bulk assign */}
        {unmappedGroups.length > 0 && (
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md text-sm">
            <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground">Assign remaining {unmappedGroups.length} to:</span>
            <input
              type="text"
              list={datalistId}
              value={bulkPublisher}
              onChange={(e) => setBulkPublisher(e.target.value)}
              placeholder="Publisher name..."
              className="flex-1 text-sm border rounded px-2 py-1 bg-background max-w-[200px]"
            />
            <Button size="sm" variant="secondary" onClick={handleBulkAssign} disabled={!bulkPublisher.trim()}>
              Apply
            </Button>
          </div>
        )}

        <datalist id={datalistId}>
          {knownPublishers.map(p => (
            <option key={p} value={p} />
          ))}
        </datalist>

        {/* Table */}
        <div className="max-h-[600px] overflow-auto border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead className="w-[160px]">Brand Value</TableHead>
                <TableHead className="w-[120px]">Sub Brand</TableHead>
                <TableHead className="w-[180px]">Sample Books</TableHead>
                <TableHead className="text-right w-[70px]">Items</TableHead>
                <TableHead className="text-right w-[90px]">Revenue</TableHead>
                <TableHead className="text-right w-[60px]">Stock</TableHead>
                <TableHead className="w-[200px]">Publisher</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleGroups.map((g, i) => {
                const isMapped = !!(userMappings[g.rawBrand]?.trim());
                const draft = drafts[g.rawBrand] || '';
                const hasSales = g.withSalesCount > 0;

                return (
                  <TableRow
                    key={g.rawBrand}
                    className={hasSales && !isMapped ? 'bg-amber-50/60' : ''}
                  >
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs break-all">{g.rawBrand}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {g.subBrands.length > 0 ? (
                        g.subBrands.map((sb, j) => (
                          <span key={j} className="block truncate max-w-[120px]">{sb}</span>
                        ))
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {g.sampleTitles.map((t, j) => (
                        <span key={j} className="block truncate max-w-[180px]">{t}</span>
                      ))}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatNumber(g.itemCount)}
                      {g.withSalesCount > 0 && (
                        <span className="text-xs text-amber-600 block">
                          {g.withSalesCount} sold
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {g.totalRevenue > 0 ? formatRupees(g.totalRevenue) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatNumber(g.totalStock)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          list={datalistId}
                          value={draft}
                          onChange={(e) =>
                            setDrafts(prev => ({ ...prev, [g.rawBrand]: e.target.value }))
                          }
                          placeholder="Type publisher..."
                          className="w-full text-sm border rounded px-2 py-1 bg-background"
                        />
                        {isMapped && (
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {visibleCount < filteredGroups.length && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
          >
            Show More ({Math.min(PAGE_SIZE, filteredGroups.length - visibleCount)} more of{' '}
            {formatNumber(filteredGroups.length - visibleCount)} remaining)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
