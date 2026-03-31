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
import {
  DataQuality as DataQualityType,
  DashboardSummary,
  UnknownBrandGroup,
} from '@/lib/types';
import { getKnownPublishers } from '@/lib/publisher-cleaner';
import { formatNumber, formatRupees } from '@/lib/format';
import {
  AlertCircle,
  Search,
  MinusCircle,
  Database,
  Save,
  Download,
  CheckCircle2,
} from 'lucide-react';

interface DataQualityProps {
  dataQuality: DataQualityType;
  summary: DashboardSummary;
  userMappings: Record<string, string>;
  onReprocess: (mappings: Record<string, string>) => Promise<void>;
}

interface QualityCardProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  detail: string;
  variant?: 'default' | 'warning' | 'info';
}

function QualityCard({ icon, title, count, detail, variant = 'default' }: QualityCardProps) {
  const bg = variant === 'warning' ? 'bg-amber-50' : variant === 'info' ? 'bg-blue-50' : 'bg-muted/50';

  return (
    <Card className={`${bg} border-0`}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-2xl font-bold">{formatNumber(count)}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Publisher Fixer ---

const PAGE_SIZE = 50;

interface PublisherFixerProps {
  groups: UnknownBrandGroup[];
  userMappings: Record<string, string>;
  onReprocess: (mappings: Record<string, string>) => Promise<void>;
}

function PublisherFixer({ groups, userMappings, onReprocess }: PublisherFixerProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    // Initialize drafts from saved mappings
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

  const knownPublishers = useMemo(() => getKnownPublishers(), []);
  const datalistId = 'known-publishers-list';

  // Which brands have unsaved changes?
  const hasUnsavedChanges = useMemo(() => {
    for (const [brand, value] of Object.entries(drafts)) {
      const saved = userMappings[brand] || '';
      if (value.trim() !== saved.trim()) return true;
    }
    return false;
  }, [drafts, userMappings]);

  const mappedCount = Object.values(userMappings).filter(v => v.trim()).length;
  const totalItems = groups.reduce((sum, g) => sum + g.itemCount, 0);
  const totalRevenue = groups.reduce((sum, g) => sum + g.totalRevenue, 0);

  const visibleGroups = groups.slice(0, visibleCount);

  async function handleSave() {
    setSaving(true);
    // Merge drafts into existing mappings (only non-empty values)
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
        <CardTitle className="text-lg">
          Publisher Fixer
          <Badge variant="secondary" className="ml-2">{groups.length} brands</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatNumber(groups.length)} brand values need mapping.{' '}
          {formatNumber(totalItems)} items, {formatRupees(totalRevenue)} revenue affected.
          {mappedCount > 0 && (
            <span className="text-green-600 font-medium"> ({mappedCount} already mapped)</span>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
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
            Export Mappings
          </Button>
          {hasUnsavedChanges && (
            <span className="text-sm text-amber-600 self-center">Unsaved changes</span>
          )}
        </div>

        <datalist id={datalistId}>
          {knownPublishers.map(p => (
            <option key={p} value={p} />
          ))}
        </datalist>

        <div className="max-h-[600px] overflow-auto border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead className="w-[180px]">Brand Value</TableHead>
                <TableHead className="w-[200px]">Sample Books</TableHead>
                <TableHead className="text-right w-[80px]">Items</TableHead>
                <TableHead className="text-right w-[90px]">Revenue</TableHead>
                <TableHead className="text-right w-[70px]">Stock</TableHead>
                <TableHead className="w-[220px]">Publisher</TableHead>
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
                      {g.sampleTitles.map((t, j) => (
                        <span key={j} className="block truncate max-w-[200px]">{t}</span>
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

        {visibleCount < groups.length && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
          >
            Show More ({Math.min(PAGE_SIZE, groups.length - visibleCount)} more of{' '}
            {formatNumber(groups.length - visibleCount)} remaining)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main Section ---

export function DataQualitySection({
  dataQuality,
  summary,
  userMappings,
  onReprocess,
}: DataQualityProps) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <QualityCard
          icon={<AlertCircle className="h-5 w-5 text-amber-500" />}
          title="Unknown Publisher"
          count={dataQuality.unknownPublisherCount}
          detail={`${dataQuality.unknownPublisherPct.toFixed(1)}% of inventory`}
          variant="warning"
        />
        <QualityCard
          icon={<MinusCircle className="h-5 w-5 text-red-500" />}
          title="Negative Quantities"
          count={dataQuality.negativeQtyCount}
          detail="Excluded from report"
          variant="warning"
        />
        <QualityCard
          icon={<Search className="h-5 w-5 text-blue-500" />}
          title="Unmatched Sales"
          count={dataQuality.unmatchedSalesCount}
          detail="Sold but not in inventory"
          variant="info"
        />
        <QualityCard
          icon={<Database className="h-5 w-5 text-muted-foreground" />}
          title="Zero Stock Items"
          count={dataQuality.zeroStockCount}
          detail={`${((dataQuality.zeroStockCount / summary.totalInventoryItems) * 100).toFixed(0)}% of inventory`}
        />
      </div>

      <PublisherFixer
        groups={dataQuality.unknownBrandGroups}
        userMappings={userMappings}
        onReprocess={onReprocess}
      />

      {dataQuality.unmatchedSalesItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Unmatched Sales Items
              <Badge variant="secondary" className="ml-2">
                {dataQuality.unmatchedSalesItems.length}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              These items appear in sales but were not found in the inventory file.
            </p>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">ISBN</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead className="text-right">Qty Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataQuality.unmatchedSalesItems
                    .sort((a, b) => b.revenue - a.revenue)
                    .map((item) => (
                      <TableRow key={item.isbn}>
                        <TableCell className="font-mono text-xs">{item.isbn}</TableCell>
                        <TableCell className="text-sm">{item.name}</TableCell>
                        <TableCell className="text-right">{item.qtySold}</TableCell>
                        <TableCell className="text-right">{formatRupees(item.revenue)}</TableCell>
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
