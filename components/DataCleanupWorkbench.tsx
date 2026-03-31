'use client';

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ProcessedData,
  Distributor,
  PublisherDistributorMapping,
  CleanupProgress,
} from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { CleanupProgressBars } from '@/components/cleanup/CleanupProgress';
import { PublisherCleanup } from '@/components/cleanup/PublisherCleanup';
import { ConsolidationManager } from '@/components/cleanup/ConsolidationManager';
import { DistributorManager } from '@/components/cleanup/DistributorManager';
import {
  exportCleanedInventoryExcel,
  exportDistributorReport,
} from '@/lib/export';
import {
  AlertCircle,
  Search,
  MinusCircle,
  Database,
  Download,
  FileSpreadsheet,
} from 'lucide-react';

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

interface DataCleanupWorkbenchProps {
  data: ProcessedData;
  userMappings: Record<string, string>;
  consolidations: Record<string, string>;
  distributors: Distributor[];
  publisherDistributorMap: PublisherDistributorMapping[];
  onReprocessMappings: (mappings: Record<string, string>) => Promise<void>;
  onReprocessConsolidations: (consolidations: Record<string, string>) => Promise<void>;
  onDistributorsChange: (distributors: Distributor[]) => void;
  onMappingsChange: (mappings: PublisherDistributorMapping[]) => void;
}

export function DataCleanupWorkbench({
  data,
  userMappings,
  consolidations,
  distributors,
  publisherDistributorMap,
  onReprocessMappings,
  onReprocessConsolidations,
  onDistributorsChange,
  onMappingsChange,
}: DataCleanupWorkbenchProps) {
  const { dataQuality, summary, items, cleanupProgress } = data;

  // Compute distributor coverage for progress
  const progressWithDistributors: CleanupProgress = useMemo(() => {
    const assignedSet = new Set(
      publisherDistributorMap
        .filter(m => m.primaryDistributorId)
        .map(m => m.publisher)
    );
    return {
      ...cleanupProgress,
      assignedPublishers: assignedSet.size,
      distributorCoverage: cleanupProgress.totalKnownPublishers > 0
        ? (assignedSet.size / cleanupProgress.totalKnownPublishers) * 100
        : 0,
    };
  }, [cleanupProgress, publisherDistributorMap]);

  return (
    <div className="space-y-8">
      {/* Quality summary cards */}
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

      {/* Progress bars */}
      <CleanupProgressBars progress={progressWithDistributors} />

      {/* Section 1: Publisher Cleanup */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Publisher Cleanup</h2>
        <div className="space-y-6">
          <PublisherCleanup
            groups={dataQuality.unknownBrandGroups}
            userMappings={userMappings}
            onReprocess={onReprocessMappings}
          />
          <ConsolidationManager
            items={items}
            consolidations={consolidations}
            onSave={onReprocessConsolidations}
          />
        </div>
      </div>

      {/* Section 2: Distributor Mapping */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Distributor Mapping</h2>
        <DistributorManager
          items={items}
          distributors={distributors}
          publisherDistributorMap={publisherDistributorMap}
          onDistributorsChange={onDistributorsChange}
          onMappingsChange={onMappingsChange}
        />
      </div>

      {/* Section 3: Export */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Export</h2>
        <Card>
          <CardContent className="py-6">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => exportCleanedInventoryExcel(items)}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download Cleaned Inventory Excel
              </Button>
              <Button
                variant="outline"
                onClick={() => exportDistributorReport(
                  items,
                  distributors,
                  publisherDistributorMap
                )}
                disabled={distributors.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Distributor Map
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Cleaned Inventory: Same format as original Excel, with Brand column updated to clean publisher names. Ready for ERP re-upload.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
