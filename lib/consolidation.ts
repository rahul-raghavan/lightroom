// Publisher consolidation: maps imprint → parent publisher
// Layer 2 in the cleaning pipeline (after raw brand → publisher)

import { PUBLISHER_ALIASES } from './publisher-cleaner';

const CONSOLIDATIONS_KEY = 'lightroom-publisher-consolidations';

/**
 * Extract built-in consolidations from the publisher-cleaner alias table.
 * These are read-only — they come from the alias mappings where multiple
 * aliases point to the same canonical publisher.
 *
 * Example: "Fourth Estate" → "HarperCollins" is a built-in consolidation
 * because "fourth estate" is an alias key mapping to "HarperCollins".
 */
export function getBuiltInConsolidations(): Record<string, string> {
  const consolidations: Record<string, string> = {};
  // Group aliases by their target publisher
  const targetToAliases = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(PUBLISHER_ALIASES)) {
    const existing = targetToAliases.get(target) || [];
    existing.push(alias);
    targetToAliases.set(target, existing);
  }

  // For publishers with multiple aliases, the alias values that are
  // distinct from the canonical name are "imprints" being consolidated
  for (const [canonical, aliases] of targetToAliases.entries()) {
    for (const alias of aliases) {
      // Title-case the alias for display
      const titleCased = alias
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      // Only add if it's a meaningfully different name (not just a casing variant)
      if (titleCased.toLowerCase() !== canonical.toLowerCase() &&
          !titleCased.toLowerCase().includes(canonical.toLowerCase().split(' ')[0].toLowerCase() + ' ')) {
        // Skip variants like "HarperCollins India" — those are just regional variants, not imprints
        // Keep genuine imprints like "Fourth Estate", "Puffin", "Vintage"
        const isRegionalVariant = titleCased.toLowerCase().endsWith(' india') ||
          titleCased.toLowerCase().endsWith(' publishers') ||
          titleCased.toLowerCase().endsWith(' publishing') ||
          titleCased.toLowerCase().endsWith(' books (uk)');
        if (!isRegionalVariant) {
          consolidations[titleCased] = canonical;
        }
      }
    }
  }

  return consolidations;
}

/**
 * Load user-defined consolidations from localStorage
 */
export function loadConsolidations(): Record<string, string> {
  try {
    const stored = localStorage.getItem(CONSOLIDATIONS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Save user-defined consolidations to localStorage
 */
export function saveConsolidations(consolidations: Record<string, string>) {
  localStorage.setItem(CONSOLIDATIONS_KEY, JSON.stringify(consolidations));
}

/**
 * Apply consolidations: if a publisher has a parent, return the parent.
 * Checks user consolidations first, then built-in ones.
 */
export function resolveParentPublisher(
  publisher: string,
  userConsolidations: Record<string, string>
): string {
  // Check user consolidations first (case-insensitive)
  const lowerPub = publisher.toLowerCase();
  for (const [imprint, parent] of Object.entries(userConsolidations)) {
    if (imprint.toLowerCase() === lowerPub && parent.trim()) {
      return parent.trim();
    }
  }
  // No user consolidation — publisher stays as-is
  // (Built-in consolidations are already handled in Layer 1 by the alias table)
  return publisher;
}

/**
 * Get all unique publishers from items, with consolidations applied
 */
export function getConsolidatedPublisherList(
  publishers: string[],
  userConsolidations: Record<string, string>
): string[] {
  const resolved = new Set<string>();
  for (const pub of publishers) {
    if (pub !== 'Unknown Publisher') {
      resolved.add(resolveParentPublisher(pub, userConsolidations));
    }
  }
  return Array.from(resolved).sort();
}
