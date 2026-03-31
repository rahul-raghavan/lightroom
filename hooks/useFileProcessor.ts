'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { parseInventoryFile, parseSalesFile } from '@/lib/parsers';
import { processData } from '@/lib/analytics';
import { ProcessedData, Distributor, PublisherDistributorMapping } from '@/lib/types';
import { loadConsolidations, saveConsolidations } from '@/lib/consolidation';
import {
  loadDistributors,
  saveDistributors as saveDistributorsToStorage,
  loadPublisherDistributorMap,
  savePublisherDistributorMap,
} from '@/lib/distributor-store';

export type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

const MAPPINGS_KEY = 'lightroom-publisher-mappings';

interface FileState {
  inventoryFile: File | null;
  salesFile: File | null;
  inventoryRowCount: number | null;
  salesRowCount: number | null;
}

interface UseFileProcessorReturn {
  fileState: FileState;
  status: ProcessingStatus;
  error: string | null;
  data: ProcessedData | null;
  userMappings: Record<string, string>;
  consolidations: Record<string, string>;
  distributors: Distributor[];
  publisherDistributorMap: PublisherDistributorMapping[];
  setInventoryFile: (file: File) => void;
  setSalesFile: (file: File) => void;
  processFiles: () => Promise<void>;
  reprocessWithMappings: (newMappings: Record<string, string>) => Promise<void>;
  reprocessWithConsolidations: (newConsolidations: Record<string, string>) => Promise<void>;
  updateDistributors: (distributors: Distributor[]) => void;
  updatePublisherDistributorMap: (mappings: PublisherDistributorMapping[]) => void;
  reset: () => void;
}

function loadMappings(): Record<string, string> {
  try {
    const stored = localStorage.getItem(MAPPINGS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveMappings(mappings: Record<string, string>) {
  localStorage.setItem(MAPPINGS_KEY, JSON.stringify(mappings));
}

export function useFileProcessor(): UseFileProcessorReturn {
  const [fileState, setFileState] = useState<FileState>({
    inventoryFile: null,
    salesFile: null,
    inventoryRowCount: null,
    salesRowCount: null,
  });
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProcessedData | null>(null);
  const [userMappings, setUserMappings] = useState<Record<string, string>>({});
  const [consolidations, setConsolidations] = useState<Record<string, string>>({});
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [publisherDistributorMap, setPublisherDistributorMap] = useState<PublisherDistributorMapping[]>([]);

  // Cache raw file buffers so we can reprocess without re-reading files
  const buffersRef = useRef<{ inventory: ArrayBuffer; sales: ArrayBuffer } | null>(null);

  // Load all persisted state from localStorage on mount
  useEffect(() => {
    setUserMappings(loadMappings());
    setConsolidations(loadConsolidations());
    setDistributors(loadDistributors());
    setPublisherDistributorMap(loadPublisherDistributorMap());
  }, []);

  const setInventoryFile = useCallback((file: File) => {
    setFileState(prev => ({ ...prev, inventoryFile: file, inventoryRowCount: null }));
    setError(null);
  }, []);

  const setSalesFile = useCallback((file: File) => {
    setFileState(prev => ({ ...prev, salesFile: file, salesRowCount: null }));
    setError(null);
  }, []);

  const runPipeline = useCallback(
    (
      inventoryBuffer: ArrayBuffer,
      salesBuffer: ArrayBuffer,
      overrides: Record<string, string>,
      consol?: Record<string, string>
    ) => {
      const inventoryResult = parseInventoryFile(inventoryBuffer, overrides);
      const salesResult = parseSalesFile(salesBuffer);

      // Process and join the data (with consolidations)
      const processed = processData(
        inventoryResult.data,
        salesResult.data,
        salesResult.daysInRange,
        salesResult.dateRange,
        consol
      );

      // Carry over negative qty count from parser errors
      const negMatch = inventoryResult.errors.find(e => e.includes('negative'));
      if (negMatch) {
        const count = parseInt(negMatch.match(/\d+/)?.[0] || '0');
        processed.dataQuality.negativeQtyCount = count;
      }

      return { processed, inventoryResult, salesResult };
    },
    []
  );

  const processFiles = useCallback(async () => {
    if (!fileState.inventoryFile || !fileState.salesFile) {
      setError('Please upload both files before generating the report.');
      return;
    }

    setStatus('processing');
    setError(null);

    try {
      const [inventoryBuffer, salesBuffer] = await Promise.all([
        fileState.inventoryFile.arrayBuffer(),
        fileState.salesFile.arrayBuffer(),
      ]);

      // Cache buffers for reprocessing
      buffersRef.current = { inventory: inventoryBuffer, sales: salesBuffer };

      const currentMappings = loadMappings();
      const currentConsolidations = loadConsolidations();
      const { processed, inventoryResult, salesResult } = runPipeline(
        inventoryBuffer,
        salesBuffer,
        currentMappings,
        currentConsolidations
      );

      setFileState(prev => ({
        ...prev,
        inventoryRowCount: inventoryResult.rowCount,
        salesRowCount: salesResult.rowCount,
      }));

      setData(processed);
      setUserMappings(currentMappings);
      setConsolidations(currentConsolidations);
      setStatus('done');
    } catch (err) {
      console.error('Processing error:', err);
      setError(
        err instanceof Error
          ? `Error processing files: ${err.message}`
          : 'An unexpected error occurred while processing the files.'
      );
      setStatus('error');
    }
  }, [fileState.inventoryFile, fileState.salesFile, runPipeline]);

  const reprocessWithMappings = useCallback(
    async (newMappings: Record<string, string>) => {
      if (!buffersRef.current) return;

      try {
        saveMappings(newMappings);
        setUserMappings(newMappings);

        const currentConsolidations = loadConsolidations();
        const { processed } = runPipeline(
          buffersRef.current.inventory,
          buffersRef.current.sales,
          newMappings,
          currentConsolidations
        );

        setData(processed);
      } catch (err) {
        console.error('Reprocessing error:', err);
        setError(
          err instanceof Error
            ? `Error reprocessing: ${err.message}`
            : 'An unexpected error occurred while reprocessing.'
        );
      }
    },
    [runPipeline]
  );

  const reprocessWithConsolidations = useCallback(
    async (newConsolidations: Record<string, string>) => {
      if (!buffersRef.current) return;

      try {
        saveConsolidations(newConsolidations);
        setConsolidations(newConsolidations);

        const currentMappings = loadMappings();
        const { processed } = runPipeline(
          buffersRef.current.inventory,
          buffersRef.current.sales,
          currentMappings,
          newConsolidations
        );

        setData(processed);
      } catch (err) {
        console.error('Reprocessing error:', err);
        setError(
          err instanceof Error
            ? `Error reprocessing: ${err.message}`
            : 'An unexpected error occurred while reprocessing.'
        );
      }
    },
    [runPipeline]
  );

  const updateDistributors = useCallback((newDistributors: Distributor[]) => {
    saveDistributorsToStorage(newDistributors);
    setDistributors(newDistributors);
  }, []);

  const updatePublisherDistributorMap = useCallback((newMappings: PublisherDistributorMapping[]) => {
    savePublisherDistributorMap(newMappings);
    setPublisherDistributorMap(newMappings);
  }, []);

  const reset = useCallback(() => {
    setFileState({
      inventoryFile: null,
      salesFile: null,
      inventoryRowCount: null,
      salesRowCount: null,
    });
    setStatus('idle');
    setError(null);
    setData(null);
    buffersRef.current = null;
  }, []);

  return {
    fileState,
    status,
    error,
    data,
    userMappings,
    consolidations,
    distributors,
    publisherDistributorMap,
    setInventoryFile,
    setSalesFile,
    processFiles,
    reprocessWithMappings,
    reprocessWithConsolidations,
    updateDistributors,
    updatePublisherDistributorMap,
    reset,
  };
}
