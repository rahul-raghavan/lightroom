'use client';

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
import { StockItem } from '@/lib/types';
import { formatDays } from '@/lib/format';

interface StockHealthProps {
  outOfStockItems: StockItem[];
  criticalItems: StockItem[];
}

export function StockHealthSection({ outOfStockItems, criticalItems }: StockHealthProps) {
  const topOutOfStock = [...outOfStockItems]
    .sort((a, b) => b.qtySold - a.qtySold)
    .slice(0, 20);

  // "Close to out of stock" = critical items that still have SOME stock (not zero)
  const closeToOutOfStock = [...criticalItems]
    .filter(i => i.currentStock > 0)
    .sort((a, b) => (a.daysOfStock ?? Infinity) - (b.daysOfStock ?? Infinity))
    .slice(0, 20);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Out of Stock but Selling
            <Badge variant="destructive" className="ml-2">{outOfStockItems.length}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            These had sales recently but have zero stock now
          </p>
        </CardHeader>
        <CardContent>
          {topOutOfStock.length === 0 ? (
            <p className="text-muted-foreground text-sm">No out-of-stock items with sales.</p>
          ) : (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">ISBN</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right w-[60px]">Sold</TableHead>
                    <TableHead className="w-[140px]">Publisher</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topOutOfStock.map((item) => (
                    <TableRow key={item.isbn} className="bg-red-50/50">
                      <TableCell className="font-mono text-xs">{item.isbn}</TableCell>
                      <TableCell className="text-sm">{item.name}</TableCell>
                      <TableCell className="text-right font-medium">{item.qtySold}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.publisher}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Close to Out of Stock
            <Badge className="bg-amber-500 ml-2">{closeToOutOfStock.length}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Selling well with less than 7 days of stock left
          </p>
        </CardHeader>
        <CardContent>
          {closeToOutOfStock.length === 0 ? (
            <p className="text-muted-foreground text-sm">No items critically low on stock.</p>
          ) : (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">ISBN</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right w-[60px]">Stock</TableHead>
                    <TableHead className="text-right w-[80px]">Days Left</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closeToOutOfStock.map((item) => (
                    <TableRow key={item.isbn} className="bg-amber-50/50">
                      <TableCell className="font-mono text-xs">{item.isbn}</TableCell>
                      <TableCell className="text-sm">{item.name}</TableCell>
                      <TableCell className="text-right font-medium">{item.currentStock}</TableCell>
                      <TableCell className="text-right">{formatDays(item.daysOfStock)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
