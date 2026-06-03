import { createHash } from 'crypto';

/**
 * Stable SHA-256 hash of (source_url + raw_text).
 * Used as the content_hash unique key in raw_content to prevent
 * the same piece of content from being ingested or processed twice.
 */
export function contentHash(sourceUrl: string, rawText: string): string {
  return createHash('sha256')
    .update(sourceUrl + '|' + rawText)
    .digest('hex');
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
