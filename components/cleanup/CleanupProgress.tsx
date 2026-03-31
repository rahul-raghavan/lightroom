'use client';

import { Progress } from '@/components/ui/progress';
import { CleanupProgress as CleanupProgressType } from '@/lib/types';
import { formatNumber } from '@/lib/format';

interface CleanupProgressProps {
  progress: CleanupProgressType;
}

export function CleanupProgressBars({ progress }: CleanupProgressProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Publisher Coverage</span>
          <span className="text-muted-foreground">
            {progress.publisherCoverage.toFixed(0)}%
          </span>
        </div>
        <Progress value={progress.publisherCoverage} className="h-2" />
        <p className="text-xs text-muted-foreground">
          {formatNumber(progress.knownPublisherItems)} of{' '}
          {formatNumber(progress.totalRevenueItems)} revenue-generating items have known publishers
        </p>
      </div>

      <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Distributor Coverage</span>
          <span className="text-muted-foreground">
            {progress.distributorCoverage.toFixed(0)}%
          </span>
        </div>
        <Progress value={progress.distributorCoverage} className="h-2" />
        <p className="text-xs text-muted-foreground">
          {formatNumber(progress.assignedPublishers)} of{' '}
          {formatNumber(progress.totalKnownPublishers)} known publishers have distributor assignments
        </p>
      </div>
    </div>
  );
}
