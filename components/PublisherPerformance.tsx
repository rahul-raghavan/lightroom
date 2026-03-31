'use client';

import {
  Treemap,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PublisherGroup } from '@/lib/types';
import { formatRupees, formatNumber } from '@/lib/format';
import { Building2 } from 'lucide-react';

interface PublisherPerformanceProps {
  publisherGroups: PublisherGroup[];
}

const TREEMAP_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#f97316',
  '#84cc16', '#a855f7', '#0ea5e9', '#22c55e', '#eab308',
];

// Custom content renderer for Treemap
interface CustomContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  index?: number;
}

function CustomTreemapContent({ x = 0, y = 0, width = 0, height = 0, name = '', index = 0 }: CustomContentProps) {
  if (width < 40 || height < 25) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={TREEMAP_COLORS[index % TREEMAP_COLORS.length]}
        stroke="#fff"
        strokeWidth={2}
        rx={4}
      />
      {width > 60 && height > 30 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={Math.min(12, width / 8)}
          fontWeight="500"
        >
          {name && name.length > width / 7 ? name.slice(0, Math.floor(width / 7)) + '...' : name}
        </text>
      )}
    </g>
  );
}

export function PublisherPerformance({ publisherGroups }: PublisherPerformanceProps) {
  const sortedByRevenue = [...publisherGroups]
    .filter(g => g.totalRevenue > 0)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  const treemapData = sortedByRevenue.slice(0, 25).map(g => ({
    name: g.publisher,
    size: g.totalRevenue,
    revenue: g.totalRevenue,
    titles: g.titlesSold,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Publisher Revenue (Treemap)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treemapData}
                dataKey="size"
                aspectRatio={4 / 3}
                content={<CustomTreemapContent />}
              >
                <Tooltip
                  formatter={(value) => [formatRupees(Number(value)), 'Revenue']}
                />
              </Treemap>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Publishers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Publisher</TableHead>
                  <TableHead className="text-right">Titles Sold</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">In Stock</TableHead>
                  <TableHead className="text-right">Critical</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedByRevenue.map((group) => (
                  <TableRow key={group.publisher}>
                    <TableCell className="font-medium">{group.publisher}</TableCell>
                    <TableCell className="text-right">{formatNumber(group.titlesSold)}</TableCell>
                    <TableCell className="text-right">{formatRupees(group.totalRevenue)}</TableCell>
                    <TableCell className="text-right">{formatNumber(group.titlesInStock)}</TableCell>
                    <TableCell className="text-right">
                      {group.criticalCount > 0 && (
                        <span className="text-red-600 font-medium">{group.criticalCount}</span>
                      )}
                      {group.criticalCount === 0 && '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
