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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Distributor, PublisherDistributorMapping, StockItem } from '@/lib/types';
import { generateDistributorId } from '@/lib/distributor-store';
import { formatNumber, formatRupees } from '@/lib/format';
import { Plus, Pencil, Trash2, Truck, Search } from 'lucide-react';

// --- Distributor List ---

interface DistributorListProps {
  distributors: Distributor[];
  onChange: (distributors: Distributor[]) => void;
}

function DistributorList({ distributors, onChange }: DistributorListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', email: '' });

  function openNew() {
    setEditingId(null);
    setForm({ name: '', contactPerson: '', phone: '', email: '' });
    setDialogOpen(true);
  }

  function openEdit(dist: Distributor) {
    setEditingId(dist.id);
    setForm({
      name: dist.name,
      contactPerson: dist.contactPerson || '',
      phone: dist.phone || '',
      email: dist.email || '',
    });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    if (editingId) {
      onChange(distributors.map(d =>
        d.id === editingId
          ? { ...d, name: form.name.trim(), contactPerson: form.contactPerson.trim() || undefined, phone: form.phone.trim() || undefined, email: form.email.trim() || undefined }
          : d
      ));
    } else {
      onChange([...distributors, {
        id: generateDistributorId(),
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      }]);
    }
    setDialogOpen(false);
  }

  function handleDelete(id: string) {
    onChange(distributors.filter(d => d.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Manage Distributors
              <Badge variant="secondary">{distributors.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Add your distributors so you can assign publishers to them.
            </p>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardHeader>
      {distributors.length > 0 && (
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributors.map((dist) => (
                  <TableRow key={dist.id}>
                    <TableCell className="font-medium">{dist.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{dist.contactPerson || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{dist.phone || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{dist.email || '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(dist)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDelete(dist.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Distributor' : 'Add Distributor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Om Book Service"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Contact Person</label>
              <Input
                value={form.contactPerson}
                onChange={(e) => setForm(prev => ({ ...prev, contactPerson: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim()}>
              {editingId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- Publisher → Distributor Assignment ---

interface AssignmentTableProps {
  items: StockItem[];
  distributors: Distributor[];
  mappings: PublisherDistributorMapping[];
  onChange: (mappings: PublisherDistributorMapping[]) => void;
}

const NONE_VALUE = '__none__';

function AssignmentTable({ items, distributors, mappings, onChange }: AssignmentTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Build publisher list with stats from parentPublisher
  const publishers = useMemo(() => {
    const pubMap = new Map<string, { count: number; revenue: number }>();
    for (const item of items) {
      if (item.parentPublisher === 'Unknown Publisher') continue;
      const existing = pubMap.get(item.parentPublisher) || { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += item.revenue;
      pubMap.set(item.parentPublisher, existing);
    }
    return Array.from(pubMap.entries())
      .map(([publisher, stats]) => ({ publisher, ...stats }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items]);

  const filteredPublishers = useMemo(() => {
    if (!searchQuery.trim()) return publishers;
    const q = searchQuery.toLowerCase();
    return publishers.filter(p => p.publisher.toLowerCase().includes(q));
  }, [publishers, searchQuery]);

  // Build lookup from mappings
  const mappingLookup = useMemo(() => {
    const map = new Map<string, PublisherDistributorMapping>();
    for (const m of mappings) {
      map.set(m.publisher, m);
    }
    return map;
  }, [mappings]);

  function updateMapping(publisher: string, field: 'primaryDistributorId' | 'secondaryDistributorId', value: string) {
    const existing = mappingLookup.get(publisher);
    const newValue = value === NONE_VALUE ? '' : value;

    if (existing) {
      const updated = mappings.map(m =>
        m.publisher === publisher ? { ...m, [field]: newValue } : m
      );
      // Remove mapping if both fields are now empty
      const check = updated.find(m => m.publisher === publisher);
      if (check && !check.primaryDistributorId && !check.secondaryDistributorId) {
        onChange(updated.filter(m => m.publisher !== publisher));
      } else {
        onChange(updated);
      }
    } else if (newValue) {
      onChange([...mappings, {
        publisher,
        primaryDistributorId: field === 'primaryDistributorId' ? newValue : '',
        secondaryDistributorId: field === 'secondaryDistributorId' ? newValue : undefined,
      }]);
    }
  }

  if (distributors.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Add distributors above first, then assign them to publishers here.
        </CardContent>
      </Card>
    );
  }

  const assignedCount = publishers.filter(p => mappingLookup.has(p.publisher) && mappingLookup.get(p.publisher)!.primaryDistributorId).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          Assign Distributors to Publishers
          <Badge variant="secondary">
            {assignedCount}/{publishers.length} assigned
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Pick a primary (and optionally secondary) distributor for each publisher.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search publishers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="max-h-[500px] overflow-auto border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[200px]">Publisher</TableHead>
                <TableHead className="text-right w-[70px]">Items</TableHead>
                <TableHead className="text-right w-[90px]">Revenue</TableHead>
                <TableHead className="w-[200px]">Primary Distributor</TableHead>
                <TableHead className="w-[200px]">Secondary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPublishers.map((pub) => {
                const mapping = mappingLookup.get(pub.publisher);
                return (
                  <TableRow key={pub.publisher}>
                    <TableCell className="font-medium text-sm">{pub.publisher}</TableCell>
                    <TableCell className="text-right text-sm">{formatNumber(pub.count)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {pub.revenue > 0 ? formatRupees(pub.revenue) : '—'}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapping?.primaryDistributorId || NONE_VALUE}
                        onValueChange={(v) => updateMapping(pub.publisher, 'primaryDistributorId', v)}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>—</SelectItem>
                          {distributors.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapping?.secondaryDistributorId || NONE_VALUE}
                        onValueChange={(v) => updateMapping(pub.publisher, 'secondaryDistributorId', v)}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>—</SelectItem>
                          {distributors.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

// --- Combined Exports ---

interface DistributorManagerProps {
  items: StockItem[];
  distributors: Distributor[];
  publisherDistributorMap: PublisherDistributorMapping[];
  onDistributorsChange: (distributors: Distributor[]) => void;
  onMappingsChange: (mappings: PublisherDistributorMapping[]) => void;
}

export function DistributorManager({
  items,
  distributors,
  publisherDistributorMap,
  onDistributorsChange,
  onMappingsChange,
}: DistributorManagerProps) {
  return (
    <div className="space-y-6">
      <DistributorList
        distributors={distributors}
        onChange={onDistributorsChange}
      />
      <AssignmentTable
        items={items}
        distributors={distributors}
        mappings={publisherDistributorMap}
        onChange={onMappingsChange}
      />
    </div>
  );
}
