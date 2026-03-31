'use client';

import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface FileDropZoneProps {
  label: string;
  description: string;
  file: File | null;
  rowCount: number | null;
  onFileSelect: (file: File) => void;
}

function FileDropZone({ label, description, file, rowCount, onFileSelect }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
        onFileSelect(droppedFile);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        onFileSelect(selectedFile);
      }
    },
    [onFileSelect]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
        isDragging
          ? 'border-primary bg-primary/5 scale-[1.02]'
          : file
          ? 'border-green-500 bg-green-50'
          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
      }`}
      onClick={() => document.getElementById(`file-${label}`)?.click()}
    >
      <input
        id={`file-${label}`}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileInput}
        className="hidden"
      />
      {file ? (
        <div className="space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <p className="font-medium text-green-800">{file.name}</p>
          <p className="text-sm text-green-600">
            {(file.size / 1024 / 1024).toFixed(1)} MB
            {rowCount !== null && ` \u00b7 ${rowCount.toLocaleString('en-IN')} rows`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{label}</p>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Drag & drop or click to browse (.xlsx)
          </p>
        </div>
      )}
    </div>
  );
}

interface FileUploaderProps {
  inventoryFile: File | null;
  salesFile: File | null;
  inventoryRowCount: number | null;
  salesRowCount: number | null;
  onInventoryFile: (file: File) => void;
  onSalesFile: (file: File) => void;
  onProcess: () => void;
  isProcessing: boolean;
}

export function FileUploader({
  inventoryFile,
  salesFile,
  inventoryRowCount,
  salesRowCount,
  onInventoryFile,
  onSalesFile,
  onProcess,
  isProcessing,
}: FileUploaderProps) {
  const bothUploaded = inventoryFile && salesFile;

  return (
    <Card className="border-0 shadow-none bg-transparent">
      <CardContent className="p-0 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Upload Your Files</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Upload your inventory and sales Excel files from the ERP system to generate the stock report.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto">
          <FileDropZone
            label="Inventory File"
            description="Inventory.xlsx from ERP"
            file={inventoryFile}
            rowCount={inventoryRowCount}
            onFileSelect={onInventoryFile}
          />
          <FileDropZone
            label="Sales File"
            description="Sales report from ERP"
            file={salesFile}
            rowCount={salesRowCount}
            onFileSelect={onSalesFile}
          />
        </div>

        <div className="text-center">
          <Button
            size="lg"
            onClick={onProcess}
            disabled={!bothUploaded || isProcessing}
            className="px-8"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Generate Report'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
