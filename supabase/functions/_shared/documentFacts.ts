/**
 * Document intelligence adapter over persisted trip attachments.
 *
 * Planitenary stores file metadata (title, mime, filenames). It does not OCR
 * or extract structured booking facts. This adapter reports metadata and an
 * explicit extraction gap rather than pretending a PDF was understood.
 */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

export interface TripDocumentMeta {
  id: string;
  title: string;
  description?: string;
  fileName?: string;
  mimeType?: string;
  createdAt?: string;
}

export interface DocumentFacts {
  documents: TripDocumentMeta[];
  selected?: TripDocumentMeta;
  extraction: 'unavailable';
  note: string;
}

const parseStorageFiles = (storagePath: unknown): { fileName?: string; mimeType?: string } => {
  if (typeof storagePath !== 'string' || !storagePath.trim()) return {};
  const trimmed = storagePath.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { files?: Array<{ name?: string; type?: string }> };
      const file = parsed.files?.[0];
      return {
        fileName: text(file?.name, 180),
        mimeType: text(file?.type, 80),
      };
    } catch {
      return {};
    }
  }
  return { fileName: trimmed.split('/').pop()?.slice(0, 180) };
};

export function presentTripDocument(row: unknown): TripDocumentMeta | undefined {
  const record = asRecord(row);
  const id = text(record?.id, 80);
  const title = text(record?.title, 160);
  if (!id || !title) return undefined;
  const nested = parseStorageFiles(record?.storage_path ?? record?.storagePath);
  return {
    id,
    title,
    description: text(record?.description, 400),
    fileName: text(record?.file_name ?? record?.fileName, 180) ?? nested.fileName,
    mimeType: text(record?.mime_type ?? record?.mimeType, 80) ?? nested.mimeType,
    createdAt: text(record?.created_at ?? record?.createdAt, 60),
  };
}

export function summarizeDocumentFacts(
  rows: unknown[],
  selectedId?: string,
): DocumentFacts {
  const documents = rows
    .map(presentTripDocument)
    .filter((entry): entry is TripDocumentMeta => Boolean(entry))
    .slice(0, 40);
  const selected = selectedId ? documents.find((entry) => entry.id === selectedId) : undefined;
  return {
    documents,
    selected,
    extraction: 'unavailable',
    note: documents.length === 0
      ? 'No documents are attached to this trip.'
      : 'I can see document titles and file types. This version of Planitenary does not extract booking times, prices, or confirmation numbers from attachments.',
  };
}
