'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PublisherGroup } from '@/lib/types';
import { formatDays } from '@/lib/format';
import { exportPublisherCSV, exportAllRestockCSV } from '@/lib/export';
import { ChevronDown, ChevronRight, Download, AlertTriangle, Info } from 'lucide-react';

interface RestockAlertsProps {
  publisherGroups: PublisherGroup[];
}

function urgencyColor(urgency: string): string {
  switch (urgency) {
    case 'critical':
    case 'out-of-stock':
      return 'bg-red-50';
    case 'warning':
      return 'bg-amber-50';
    default:
      return '';
  }
}

function urgencyBadge(urgency: string) {
  switch (urgency) {
    case 'out-of-stock':
      return <Badge variant="destructive" className="text-[10px] px-1.5">OUT</Badge>;
    case 'critical':
      return <Badge variant="destructive" className="text-[10px] px-1.5">Critical</Badge>;
    case 'warning':
      return <Badge className="bg-amber-500 text-[10px] px-1.5">Warning</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px] px-1.5">OK</Badge>;
  }
}

function PublisherCard({ group }: { group: PublisherGroup }) {
  const [isOpen, setIsOpen] = useState(group.criticalCount > 0);
  const hasUrgent = group.criticalCount > 0 || group.warningCount > 0;

  return (
    <Card className={hasUrgent ? 'border-amber-200' : ''}>
      <CardHeader
        className="cursor-pointer py-3 px-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base font-semibold">{group.publisher}</CardTitle>
            <span className="text-sm text-muted-foreground">
              {group.items.length} titles
            </span>
            {group.criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {group.criticalCount} critical
              </Badge>
            )}
            {group.warningCount > 0 && (
              <Badge className="bg-amber-500 text-xs">
                {group.warningCount} warning
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              exportPublisherCSV(group);
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0 px-4 pb-4">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">ISBN</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right w-[80px]">Stock</TableHead>
                  <TableHead className="text-right w-[80px]">Sold</TableHead>
                  <TableHead className="text-right w-[100px]">Days Left</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => (
                  <TableRow key={item.isbn} className={urgencyColor(item.restockUrgency)}>
                    <TableCell className="font-mono text-xs">{item.isbn}</TableCell>
                    <TableCell className="text-sm max-w-[250px] truncate">{item.name}</TableCell>
                    <TableCell className="text-right font-medium">{item.currentStock}</TableCell>
                    <TableCell className="text-right">{item.qtySold}</TableCell>
                    <TableCell className="text-right">{formatDays(item.daysOfStock)}</TableCell>
                    <TableCell>{urgencyBadge(item.restockUrgency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function RestockAlerts({ publisherGroups }: RestockAlertsProps) {
  const restockGroups = publisherGroups.filter(
    g => g.items.some(i =>
      i.restockUrgency === 'critical' ||
      i.restockUrgency === 'warning' ||
      i.restockUrgency === 'out-of-stock'
    )
  );

  const unknownGroup = publisherGroups.find(g => g.publisher === 'Unknown Publisher');
  const regularGroups = publisherGroups.filter(g => g.publisher !== 'Unknown Publisher');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-semibold">
            Restock by Publisher
          </h3>
          <span className="text-sm text-muted-foreground">
            {restockGroups.length} publishers need attention
          </span>
        </div>
        <Button
          variant="outline"
          onClick={() => exportAllRestockCSV(publisherGroups)}
        >
          <Download className="h-4 w-4 mr-2" />
          Download All CSV
        </Button>
      </div>

      <div className="space-y-3">
        {regularGroups.map((group) => (
          <PublisherCard key={group.publisher} group={group} />
        ))}

        {unknownGroup && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Info className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                These items have no publisher info in the ERP. Use the ISBN to look them up.
              </p>
            </div>
            <PublisherCard group={unknownGroup} />
          </div>
        )}
      </div>
    </div>
  );
}
