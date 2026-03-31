'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, BookOpen, Check, Copy, Loader2, Search, ShoppingBasket, Sparkles, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, formatRupees } from '@/lib/format';
import type {
  WorkspaceFilters,
  WorkspaceMeta,
  WorkspaceSearchRow,
  WorkspaceSort,
} from '@/lib/workspace';

interface DraftResponse {
  draftId: string;
  title: string;
  groups: Array<{
    groupKey: string;
    distributorName?: string;
    itemCount: number;
    preview: string;
  }>;
}

interface BasketItem {
  row: WorkspaceSearchRow;
  quantity: number;
  distributorIds: string[];
}

interface NaturalLanguageInterpretation {
  mode: 'heuristic' | 'openai';
  explanation: string;
  filters: WorkspaceFilters;
}

const DEFAULT_FILTERS: WorkspaceFilters = {
  query: '',
  publisher: '',
  distributor: '',
  ageGroup: '',
  category: '',
  stock: 'all',
  stockMin: undefined,
  stockMax: undefined,
  mapped: 'all',
  cleanup: 'all',
  missing: [],
  onlyRevenue: false,
  limit: 100,
  sort: 'revenue_desc',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function formatUtcDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function parseInventorySnapshotDate(meta: WorkspaceMeta | null): Date | null {
  const inventoryFile = meta?.sourceFiles?.inventoryFile;
  if (!inventoryFile) return null;

  const match = inventoryFile.match(/(\d{1,2})\s+([A-Za-z]{3,9})/);
  if (!match) return null;

  const day = Number(match[1]);
  const monthIndex = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
  if (!day || monthIndex < 0) return null;

  const builtDate = new Date(meta?.lastBuilt || '');
  const builtYear = Number.isNaN(builtDate.getTime()) ? new Date().getUTCFullYear() : builtDate.getUTCFullYear();
  const builtMonth = Number.isNaN(builtDate.getTime()) ? monthIndex : builtDate.getUTCMonth();
  const year = monthIndex > builtMonth ? builtYear - 1 : builtYear;

  return new Date(Date.UTC(year, monthIndex, day));
}

function buildSalesWindowLabel(meta: WorkspaceMeta | null, inventorySnapshotDate: Date | null): string {
  const salesFile = meta?.sourceFiles?.salesFile;
  if (!salesFile || !inventorySnapshotDate) {
    return salesFile || 'Latest loaded sales data';
  }

  const match = salesFile.match(/([A-Za-z]{3,9})\s+to\s+([A-Za-z]{3,9})/i);
  if (!match) return salesFile;

  const startMonth = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
  if (startMonth < 0) return salesFile;

  const endMonth = inventorySnapshotDate.getUTCMonth();
  const endYear = inventorySnapshotDate.getUTCFullYear();
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  const startDate = new Date(Date.UTC(startYear, startMonth, 1));

  return `${formatUtcDate(startDate)} to ${formatUtcDate(inventorySnapshotDate)}`;
}

function WorkspaceHeader() {
  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <BookOpen className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Workspace</h1>
            <p className="text-xs text-muted-foreground">Search books, build baskets, and prepare distributor-ready drafts</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void handleSignOut(); }}>
          Sign out
        </Button>
      </div>
    </header>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export default function WorkspacePage() {
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null);
  const [results, setResults] = useState<WorkspaceSearchRow[]>([]);
  const [filters, setFilters] = useState<WorkspaceFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlExplanation, setNlExplanation] = useState('');
  const [nlInterpretation, setNlInterpretation] = useState<NaturalLanguageInterpretation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftResult, setDraftResult] = useState<DraftResponse | null>(null);
  const [copiedGroupKey, setCopiedGroupKey] = useState<string | null>(null);
  const [basket, setBasket] = useState<Record<string, BasketItem>>({});

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/workspace');
        if (!res.ok) throw new Error('Failed to load workspace metadata');
        const data = await res.json() as WorkspaceMeta;
        setMeta(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load workspace');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function runSearch(nextFilters: WorkspaceFilters) {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: nextFilters }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Search failed');
      }
      const data = await res.json() as { results: WorkspaceSearchRow[] };
      setResults(data.results);
      setFilters(nextFilters);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!meta) return;
    void runSearch(DEFAULT_FILTERS);
  }, [meta]);

  const basketItems = useMemo(() => Object.values(basket), [basket]);
  const basketCount = basketItems.reduce((sum, item) => sum + item.quantity, 0);
  const inventorySnapshotDate = useMemo(() => parseInventorySnapshotDate(meta), [meta]);
  const inventorySnapshotLabel = useMemo(() => {
    if (inventorySnapshotDate) return formatUtcDate(inventorySnapshotDate);
    return meta?.sourceFiles?.inventoryFile || 'Latest loaded inventory';
  }, [inventorySnapshotDate, meta]);
  const salesWindowLabel = useMemo(
    () => buildSalesWindowLabel(meta, inventorySnapshotDate),
    [inventorySnapshotDate, meta]
  );

  function updateFilter<K extends keyof WorkspaceFilters>(key: K, value: WorkspaceFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  function updateNumberFilter(key: 'stockMin' | 'stockMax', value: string) {
    const trimmed = value.trim();
    updateFilter(key, trimmed ? Math.max(0, Number(trimmed) || 0) : undefined);
  }

  function toggleSort(column: 'stock' | 'sales') {
    const currentSort = filters.sort || 'revenue_desc';
    const nextSort: WorkspaceSort = column === 'stock'
      ? (currentSort === 'stock_desc' ? 'stock_asc' : 'stock_desc')
      : (currentSort === 'sales_desc' ? 'sales_asc' : 'sales_desc');

    const nextFilters = {
      ...filters,
      sort: nextSort,
    };
    void runSearch(nextFilters);
  }

  function setSort(sort: WorkspaceSort) {
    const nextFilters = {
      ...filters,
      sort,
    };
    void runSearch(nextFilters);
  }

  function sortIndicator(column: 'stock' | 'sales'): string {
    const currentSort = filters.sort || 'revenue_desc';
    if (column === 'stock') {
      if (currentSort === 'stock_desc') return '↓';
      if (currentSort === 'stock_asc') return '↑';
    }
    if (column === 'sales') {
      if (currentSort === 'sales_desc') return '↓';
      if (currentSort === 'sales_asc') return '↑';
    }
    return '';
  }

  function toggleMissing(field: 'author' | 'publisher' | 'tags') {
    setFilters(current => {
      const currentMissing = current.missing || [];
      return {
        ...current,
        missing: currentMissing.includes(field)
          ? currentMissing.filter(value => value !== field)
          : [...currentMissing, field],
      };
    });
  }

  function addToBasket(row: WorkspaceSearchRow) {
    setBasket(current => {
      const existing = current[row.isbn];
      const defaultDistributorIds = row.distributorIds.length > 0 ? [row.distributorIds[0]] : [];
      return {
        ...current,
        [row.isbn]: {
          row,
          quantity: existing ? existing.quantity + 1 : 1,
          distributorIds: existing ? existing.distributorIds : defaultDistributorIds,
        },
      };
    });
  }

  function updateBasketQuantity(isbn: string, quantity: number) {
    setBasket(current => {
      if (quantity <= 0) {
        const next = { ...current };
        delete next[isbn];
        return next;
      }
      return {
        ...current,
        [isbn]: {
          ...current[isbn],
          quantity,
        },
      };
    });
  }

  function toggleBasketDistributor(isbn: string, distributorId: string, checked: boolean) {
    setBasket(current => {
      const item = current[isbn];
      if (!item) return current;

      const availableDistributorIds = item.row.distributorIds;
      if (availableDistributorIds.length === 0) return current;

      const nextSelected = checked
        ? Array.from(new Set([...item.distributorIds, distributorId]))
        : item.distributorIds.filter(currentId => currentId !== distributorId);

      const normalizedSelected = nextSelected.filter(currentId => availableDistributorIds.includes(currentId));
      const distributorIds = normalizedSelected.length > 0 ? normalizedSelected : [availableDistributorIds[0]];

      return {
        ...current,
        [isbn]: {
          ...item,
          distributorIds,
        },
      };
    });
  }

  async function handleAskNaturalLanguage() {
    if (!nlPrompt.trim()) return;
    setNlLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/nl-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: nlPrompt }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Could not interpret the prompt');
      }
      const data = await res.json() as {
        mode: 'heuristic' | 'openai';
        filters: WorkspaceFilters;
        explanation: string;
      };
      const nextFilters = {
        ...DEFAULT_FILTERS,
        ...data.filters,
      };
      setNlExplanation(data.mode === 'openai' ? 'OpenAI interpreted this request.' : 'Local fallback interpreted this request.');
      setNlInterpretation(data);
      await runSearch(nextFilters);
    } catch (nlError) {
      setError(nlError instanceof Error ? nlError.message : 'Natural-language parsing failed');
    } finally {
      setNlLoading(false);
    }
  }

  async function handleCreateDraft() {
    if (basketItems.length === 0) return;
    setCreatingDraft(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/order-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          notes: draftNotes,
          items: basketItems.map(item => ({
            isbn: item.row.isbn,
            quantity: item.quantity,
            distributorIds: item.distributorIds,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Could not create order draft');
      }
      const data = await res.json() as DraftResponse;
      setDraftResult(data);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : 'Could not create order draft');
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleCopyDraft(groupKey: string, preview: string) {
    try {
      await navigator.clipboard.writeText(preview);
      setCopiedGroupKey(groupKey);
      window.setTimeout(() => setCopiedGroupKey(current => current === groupKey ? null : current), 2000);
    } catch {
      setError('Could not copy the draft to the clipboard.');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <WorkspaceHeader />
        <main className="max-w-7xl mx-auto px-4 py-10">
          <p className="text-muted-foreground">Loading workspace…</p>
        </main>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="min-h-screen bg-background">
        <WorkspaceHeader />
        <main className="max-w-7xl mx-auto px-4 py-10">
          <p className="text-red-600">{error || 'Workspace metadata is unavailable.'}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <WorkspaceHeader />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <Card className="border-amber-300 bg-amber-50/70">
          <CardContent className="px-5 py-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">Current data snapshot</p>
            <p className="text-sm font-medium text-amber-950">Inventory snapshot: {inventorySnapshotLabel}</p>
            <p className="text-sm font-medium text-amber-950">Sales window: {salesWindowLabel}</p>
            <p className="text-xs text-amber-900/80">
              {meta.sourceFiles?.inventoryFile || 'Inventory file'} · {meta.sourceFiles?.salesFile || 'Sales file'}
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-3 px-4">
              <p className="text-xs text-muted-foreground">Books in catalog</p>
              <p className="text-xl font-bold">{formatNumber(meta.summary.books)}</p>
              <p className="text-xs text-muted-foreground">All in-scope book ISBNs currently in the master catalog.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <p className="text-xs text-muted-foreground">Ready to order</p>
              <p className="text-xl font-bold">{formatNumber(meta.summary.complete)}</p>
              <p className="text-xs text-muted-foreground">Books that have all three fields populated: author, publisher, and tags.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <p className="text-xs text-muted-foreground">Revenue books</p>
              <p className="text-xl font-bold">{formatNumber(meta.summary.revenueBooks)}</p>
              <p className="text-xs text-muted-foreground">Books with recorded sales in the current sales file.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-blue-200 bg-blue-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5" />
              Ask In Natural Language
              <Badge variant="secondary">{meta.nlMode === 'openai' ? 'OpenAI + fallback' : 'Heuristic fallback'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3">
              <Input
                value={nlPrompt}
                onChange={event => setNlPrompt(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleAskNaturalLanguage();
                  }
                }}
                placeholder="Example: show me all Pratham books with low stock and no tags"
              />
              <Button onClick={() => { void handleAskNaturalLanguage(); }} disabled={nlLoading}>
                {nlLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Ask
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Press Enter to ask.</span>
              {nlInterpretation && (
                <Badge variant="outline">
                  {nlInterpretation.mode === 'openai' ? 'OpenAI used' : 'Local fallback used'}
                </Badge>
              )}
              {nlExplanation && <span>{nlExplanation}</span>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="space-y-6 min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="h-5 w-5" />
                  Search & Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Search by title, ISBN, author, publisher, imprint, parent publisher, or tags. Age group uses the catalog reading bands, and category uses the broad browse buckets already stored on each book.
                </p>

                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <Input
                    value={filters.query || ''}
                    onChange={event => updateFilter('query', event.target.value)}
                    placeholder="Search title, ISBN, author, publisher, tags"
                  />
                  <Input
                    list="workspace-publishers"
                    value={filters.publisher || ''}
                    onChange={event => updateFilter('publisher', event.target.value)}
                    placeholder="Publisher or parent"
                  />
                  <datalist id="workspace-publishers">
                    {meta.publishers.map(option => <option key={option} value={option} />)}
                  </datalist>
                  <Input
                    list="workspace-distributors"
                    value={filters.distributor || ''}
                    onChange={event => updateFilter('distributor', event.target.value)}
                    placeholder="Distributor"
                  />
                  <datalist id="workspace-distributors">
                    {meta.distributors.map(option => <option key={option} value={option} />)}
                  </datalist>
                  <FilterSelect
                    value={filters.stock || 'all'}
                    onChange={value => updateFilter('stock', value as WorkspaceFilters['stock'])}
                    options={[
                      { value: 'all', label: 'All stock states' },
                      { value: 'in', label: 'In stock' },
                      { value: 'low', label: 'Low stock (1-5)' },
                      { value: 'out', label: 'Out of stock' },
                    ]}
                  />
                  <FilterSelect
                    value={filters.mapped || 'all'}
                    onChange={value => updateFilter('mapped', value as WorkspaceFilters['mapped'])}
                    options={[
                      { value: 'all', label: 'Mapped + unmapped' },
                      { value: 'mapped', label: 'Mapped distributors' },
                      { value: 'unmapped', label: 'Unmapped distributors' },
                    ]}
                  />
                  <FilterSelect
                    value={filters.cleanup || 'all'}
                    onChange={value => updateFilter('cleanup', value as WorkspaceFilters['cleanup'])}
                    options={[
                      { value: 'all', label: 'All cleanup states' },
                      { value: 'clean', label: 'Ready to order' },
                      { value: 'needs-attention', label: 'Needs cleanup' },
                    ]}
                  />
                  <FilterSelect
                    value={filters.ageGroup || ''}
                    onChange={value => updateFilter('ageGroup', value)}
                    options={[
                      { value: '', label: 'All age groups' },
                      ...meta.ageGroups.map(option => ({ value: option, label: option })),
                    ]}
                  />
                  <FilterSelect
                    value={filters.category || ''}
                    onChange={value => updateFilter('category', value)}
                    options={[
                      { value: '', label: 'All categories' },
                      ...meta.categories.map(option => ({ value: option, label: option })),
                    ]}
                  />
                  <Input
                    type="number"
                    min={0}
                    value={filters.stockMin === undefined ? '' : String(filters.stockMin)}
                    onChange={event => updateNumberFilter('stockMin', event.target.value)}
                    placeholder="Minimum stock"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={filters.stockMax === undefined ? '' : String(filters.stockMax)}
                    onChange={event => updateNumberFilter('stockMax', event.target.value)}
                    placeholder="Maximum stock"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={filters.onlyRevenue || false}
                      onChange={event => updateFilter('onlyRevenue', event.target.checked)}
                    />
                    Revenue books only
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(filters.missing || []).includes('author')}
                      onChange={() => toggleMissing('author')}
                    />
                    Missing author
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(filters.missing || []).includes('publisher')}
                      onChange={() => toggleMissing('publisher')}
                    />
                    Missing publisher
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(filters.missing || []).includes('tags')}
                      onChange={() => toggleMissing('tags')}
                    />
                    Missing tags
                  </label>
                </div>

                <div className="flex gap-3">
                  <Button onClick={() => {
                    setNlInterpretation(null);
                    setNlExplanation('');
                    void runSearch(filters);
                  }} disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                    Search
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setNlInterpretation(null);
                      setNlExplanation('');
                      setFilters(DEFAULT_FILTERS);
                      void runSearch(DEFAULT_FILTERS);
                    }}
                    disabled={searching}
                  >
                    Reset
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  `Minimum stock` and `Maximum stock` use the current inventory quantity. For example, `minimum stock = 6` means `more than 5 units`.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">{formatNumber(results.length)} results shown</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Sort results</span>
                    <Button
                      size="sm"
                      variant={filters.sort === 'revenue_desc' ? 'default' : 'outline'}
                      onClick={() => setSort('revenue_desc')}
                    >
                      Default
                    </Button>
                    <Button
                      size="sm"
                      variant={filters.sort === 'sales_desc' || filters.sort === 'sales_asc' ? 'default' : 'outline'}
                      onClick={() => toggleSort('sales')}
                    >
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      Sales {sortIndicator('sales') || '↓'}
                    </Button>
                    <Button
                      size="sm"
                      variant={filters.sort === 'stock_desc' || filters.sort === 'stock_asc' ? 'default' : 'outline'}
                      onClick={() => toggleSort('stock')}
                    >
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      Stock {sortIndicator('stock') || '↓'}
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Book</TableHead>
                        <TableHead>Publisher</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Sales</TableHead>
                        <TableHead>Distributor</TableHead>
                        <TableHead>Cleanup</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map(row => (
                        <TableRow key={row.isbn}>
                          <TableCell className="align-top">
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground">{row.isbn}</div>
                            {row.author && <div className="text-xs text-muted-foreground">{row.author}</div>}
                            {nlInterpretation && row.matchBasis.length > 0 && (
                              <div className="mt-2 rounded-md bg-slate-50 px-2 py-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {row.matchConfidence && (
                                    <Badge variant="outline">
                                      {row.matchConfidence} confidence
                                    </Badge>
                                  )}
                                  <span className="text-[11px] text-muted-foreground">
                                    Why this matched: {row.matchBasis.join(' · ')}
                                  </span>
                                </div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <div>{row.publisher}</div>
                            {row.parentPublisher && row.parentPublisher !== row.publisher && (
                              <div className="text-xs text-muted-foreground">Parent: {row.parentPublisher}</div>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="font-medium">{formatNumber(row.currentStock)}</div>
                            <div className="text-xs text-muted-foreground">{row.currentStock <= 0 ? 'Out' : row.currentStock <= 5 ? 'Low' : 'Available'}</div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div>{formatNumber(row.qtySold)} sold</div>
                            <div className="text-xs text-muted-foreground">{formatRupees(row.revenue)}</div>
                          </TableCell>
                          <TableCell className="align-top">
                            {row.distributorMapped ? (
                              <div className="space-y-1">
                                {row.distributors.map(name => (
                                  <Badge key={name} variant="outline">{name}</Badge>
                                ))}
                              </div>
                            ) : (
                              <Badge variant="outline" className="border-red-300 text-red-700">Unmapped</Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex flex-wrap gap-1">
                              {row.missing.author && <Badge variant="secondary">No author</Badge>}
                              {row.missing.publisher && <Badge variant="secondary">No publisher</Badge>}
                              {row.missing.tags && <Badge variant="secondary">No tags</Badge>}
                              {row.cleanupReady && <Badge variant="outline" className="border-green-400 text-green-700">Ready</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <Button size="sm" onClick={() => addToBasket(row)}>Add</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 min-w-0">
            <Card className="xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:flex xl:flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShoppingBasket className="h-5 w-5" />
                  Order Basket
                  <Badge variant="secondary">{formatNumber(basketCount)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 xl:overflow-y-auto xl:flex-1">
                {basketItems.length === 0 && (
                  <p className="text-sm text-muted-foreground">Add books from the results table to start an order draft.</p>
                )}

                {basketItems.map(item => (
                  <div key={item.row.isbn} className="border rounded-md p-3 space-y-3">
                    <div>
                      <p className="font-medium text-sm">{item.row.name}</p>
                      <p className="text-xs text-muted-foreground">{item.row.publisher} · {item.row.isbn}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        value={String(item.quantity)}
                        onChange={event => updateBasketQuantity(item.row.isbn, Number(event.target.value) || 0)}
                      />
                      <Button variant="outline" size="sm" onClick={() => updateBasketQuantity(item.row.isbn, 0)}>Remove</Button>
                    </div>
                    {item.row.distributorIds.length > 1 && (
                      <div className="rounded-md border bg-slate-50 p-3 space-y-2">
                        <p className="text-xs font-medium text-slate-900">Choose distributors for this title</p>
                        <div className="space-y-2">
                          {item.row.distributorIds.map((distributorId, index) => (
                            <label key={distributorId} className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={item.distributorIds.includes(distributorId)}
                                onChange={event => toggleBasketDistributor(item.row.isbn, distributorId, event.target.checked)}
                              />
                              <span>{item.row.distributors[index] || distributorId}</span>
                            </label>
                          ))}
                        </div>
                        <p className="text-[11px] text-slate-500">Each selected distributor will get its own draft.</p>
                      </div>
                    )}
                    {item.row.distributorIds.length === 1 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Truck className="h-3 w-3" /> {item.row.distributors[0]}</p>
                    )}
                    {item.row.distributorIds.length === 0 && (
                      <p className="text-xs text-red-600">No distributor mapped for {item.row.assignmentKey}</p>
                    )}
                  </div>
                ))}

                <div className="space-y-3 border-t pt-4">
                  <Input
                    value={draftTitle}
                    onChange={event => setDraftTitle(event.target.value)}
                    placeholder="Draft title"
                  />
                  <textarea
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={draftNotes}
                    onChange={event => setDraftNotes(event.target.value)}
                    placeholder="Optional notes for the distributors"
                  />
                  <Button onClick={() => { void handleCreateDraft(); }} disabled={creatingDraft || basketItems.length === 0} className="w-full">
                    {creatingDraft ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Truck className="h-4 w-4 mr-2" />}
                    Create Order Draft
                  </Button>
                </div>

                {draftResult && (
                  <div className="space-y-3 border-t pt-4">
                    <div className="space-y-1">
                      <p className="font-medium">{draftResult.title}</p>
                      <p className="text-xs text-muted-foreground">Copy the email text below and paste it into your mail client.</p>
                    </div>
                    {draftResult.groups.map(group => (
                      <div key={group.groupKey} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-sm">{group.distributorName || group.groupKey}</p>
                            <p className="text-xs text-muted-foreground">{formatNumber(group.itemCount)} titles in this draft</p>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => { void handleCopyDraft(group.groupKey, group.preview); }}>
                            {copiedGroupKey === group.groupKey ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                            {copiedGroupKey === group.groupKey ? 'Copied' : 'Copy draft'}
                          </Button>
                        </div>
                        <pre className="text-[11px] whitespace-pre-wrap bg-slate-50 rounded p-2 border overflow-auto max-h-40">{group.preview}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
