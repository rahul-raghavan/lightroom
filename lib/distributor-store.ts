// localStorage CRUD helpers for distributors and publisher-distributor mappings

import { Distributor, PublisherDistributorMapping } from './types';

const DISTRIBUTORS_KEY = 'lightroom-distributors';
const PUB_DIST_MAP_KEY = 'lightroom-publisher-distributor-map';

// --- Distributors ---

export function loadDistributors(): Distributor[] {
  try {
    const stored = localStorage.getItem(DISTRIBUTORS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveDistributors(distributors: Distributor[]) {
  localStorage.setItem(DISTRIBUTORS_KEY, JSON.stringify(distributors));
}

export function generateDistributorId(): string {
  return `dist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// --- Publisher → Distributor Mappings ---

export function loadPublisherDistributorMap(): PublisherDistributorMapping[] {
  try {
    const stored = localStorage.getItem(PUB_DIST_MAP_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function savePublisherDistributorMap(mappings: PublisherDistributorMapping[]) {
  localStorage.setItem(PUB_DIST_MAP_KEY, JSON.stringify(mappings));
}
