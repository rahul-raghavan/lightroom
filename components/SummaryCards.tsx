'use client';

import { Card, CardContent } from '@/components/ui/card';
import { DashboardSummary } from '@/lib/types';
import { formatRupees, formatNumber } from '@/lib/format';
import {
  IndianRupee,
  ShoppingCart,
  BookOpen,
  AlertTriangle,
  XCircle,
  CalendarDays,
  PackageX,
} from 'lucide-react';

interface SummaryCardsProps {
  summary: DashboardSummary;
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'warning' | 'danger';
}

function StatCard({ title, value, subtitle, icon, variant = 'default' }: StatCardProps) {
  const bgColor = variant === 'danger' ? 'bg-red-50' : variant === 'warning' ? 'bg-amber-50' : 'bg-muted/50';
  const iconColor = variant === 'danger' ? 'text-red-500' : variant === 'warning' ? 'text-amber-500' : 'text-primary';

  return (
    <Card className={`${bgColor} border-0`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`${iconColor} mt-0.5`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      <StatCard
        title="Total Revenue"
        value={formatRupees(summary.totalRevenue)}
        subtitle={`${formatNumber(summary.totalSalesItems)} products`}
        icon={<IndianRupee className="h-5 w-5" />}
      />
      <StatCard
        title="Units Sold"
        value={formatNumber(summary.unitsSold)}
        subtitle={`${formatNumber(summary.activeTitles)} titles`}
        icon={<ShoppingCart className="h-5 w-5" />}
      />
      <StatCard
        title="Active Titles"
        value={formatNumber(summary.activeTitles)}
        subtitle="Had sales in period"
        icon={<BookOpen className="h-5 w-5" />}
      />
      <StatCard
        title="In Stock, No Sales"
        value={formatNumber(summary.inStockNoSales)}
        subtitle="Have stock but didn't sell"
        icon={<PackageX className="h-5 w-5" />}
      />
      <StatCard
        title="Need Restock"
        value={formatNumber(summary.needsRestock)}
        subtitle="< 21 days stock"
        icon={<AlertTriangle className="h-5 w-5" />}
        variant="warning"
      />
      <StatCard
        title="Out of Stock"
        value={formatNumber(summary.outOfStockWithSales)}
        subtitle="With recent sales"
        icon={<XCircle className="h-5 w-5" />}
        variant="danger"
      />
      <StatCard
        title="Data Period"
        value={summary.datePeriod.split(' to ')[0] || '—'}
        subtitle={summary.datePeriod.includes('to') ? `to ${summary.datePeriod.split(' to ')[1]}` : summary.datePeriod}
        icon={<CalendarDays className="h-5 w-5" />}
      />
    </div>
  );
}
