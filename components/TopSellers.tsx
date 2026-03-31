'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StockItem } from '@/lib/types';
import { formatRupees, formatDays, formatNumber } from '@/lib/format';
import { exportTopSellersCSV } from '@/lib/export';
import { TOP_SELLERS_CHART_COUNT, TOP_SELLERS_TABLE_COUNT } from '@/lib/constants';
import { Download, TrendingUp } from 'lucide-react';

interface TopSellersProps {
  items: StockItem[];
}

export function TopSellers({ items }: TopSellersProps) {
  const topByQty = [...items]
    .filter(i => i.qtySold > 0)
    .sort((a, b) => b.qtySold - a.qtySold);

  const chartItems = topByQty.slice(0, TOP_SELLERS_CHART_COUNT);
  const tableItems = topByQty.slice(0, TOP_SELLERS_TABLE_COUNT);

  const chartData = chartItems.map(item => ({
    name: item.name.length > 30 ? item.name.slice(0, 30) + '...' : item.name,
    sold: item.qtySold,
    isbn: item.isbn,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Top {TOP_SELLERS_CHART_COUNT} by Units Sold</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={() => exportTopSellersCSV(tableItems)}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[500px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={220}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value) => [formatNumber(Number(value)), 'Units Sold']}
                  labelFormatter={(label) => {
                    const item = chartData.find(d => d.name === label);
                    return item ? `${label} (${item.isbn})` : label;
                  }}
                />
                <Bar dataKey="sold" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top {TOP_SELLERS_TABLE_COUNT} Sellers — Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">#</TableHead>
                  <TableHead className="w-[130px]">ISBN</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Publisher</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Days Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableItems.map((item, index) => (
                  <TableRow key={item.isbn}>
                    <TableCell className="font-medium text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{item.isbn}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{item.name}</TableCell>
                    <TableCell className="text-sm">{item.publisher}</TableCell>
                    <TableCell className="text-right font-medium">{formatNumber(item.qtySold)}</TableCell>
                    <TableCell className="text-right">{formatRupees(item.revenue)}</TableCell>
                    <TableCell className="text-right">
                      {item.currentStock === 0 ? (
                        <Badge variant="destructive" className="text-xs">0</Badge>
                      ) : (
                        item.currentStock
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatDays(item.daysOfStock)}</TableCell>
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
