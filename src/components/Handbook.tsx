import { useEffect, useRef, useState } from 'react';
import type { ActivityType, Itinerary } from '../data';
import { Plus, Link as LinkIcon, Trash2, CheckCircle2, Edit2, Save, X, ExternalLink, BookOpen, ImagePlus } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ThemedSelect } from './ui/ThemedSelect';

type DraftItem = {
  id: string;
  name: string;
  link: string;
  note: string;
  day: number;
  time: string;
  type: ActivityType;
  isRedNote?: boolean;
  previewTitle?: string;
  previewText?: string;
  thumbnailUrl?: string;
  screenshotUrls?: string[];
  updatedAt?: string;
};

const activityTypes: { value: ActivityType; label: string }[] = [
  { value: 'sight', label: 'Sightseeing' },
  { value: 'food', label: 'Food' },
  { value: 'culture', label: 'Culture' },
  { value: 'walk', label: 'Walking' },
  { value: 'nature', label: 'Nature' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'shop', label: 'Shopping' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'other', label: 'Other' }
];

const normalizeLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const isRedNoteLink = (value: string) => {
  const normalized = normalizeLink(value);
  return /xiaohongshu\.com|xhslink\.com|rednote/i.test(normalized);
};

const toSafeHttpLink = (value: string) => normalizeLink(value).replace(/^http:\/\//i, 'https://');

const normalizeMediaUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'https://');
  return toSafeHttpLink(trimmed);
};

const getJinaProxyUrl = (value: string) => {
  const normalized = toSafeHttpLink(value).replace(/^https?:\/\//i, '');
  return `https://r.jina.ai/http://${normalized}`;
};

const isIncomingNewerOrEqual = (incoming?: string, current?: string) => {
  if (!incoming) return true;
  if (!current) return true;
  return new Date(incoming).getTime() >= new Date(current).getTime();
};

const MAX_SCREENSHOTS = 6;
const MAX_SCREENSHOT_SIZE_MB = 8;
const SCREENSHOT_BUCKET = 'draft-screenshots';

const sortDraftsNewestFirst = (items: DraftItem[]) =>
  [...items].sort(
    (a, b) =>
      new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );

const isDataUrl = (value: string) => value.trim().startsWith('data:');

const stripInlineMediaFromDraft = (item: DraftItem): DraftItem => ({
  ...item,
  thumbnailUrl: item.thumbnailUrl && !isDataUrl(item.thumbnailUrl) ? normalizeMediaUrl(item.thumbnailUrl) : undefined,
  screenshotUrls: (item.screenshotUrls || [])
    .filter((url): url is string => typeof url === 'string' && !isDataUrl(url))
    .map((url) => normalizeMediaUrl(url))
    .filter(Boolean)
});

const safeParseDrafts = (raw: string | null): DraftItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortDraftsNewestFirst(parsed as DraftItem[]);
  } catch (error) {
    console.error('Failed to parse drafts', error);
    return [];
  }
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const filesToDataUrls = async (fileList: FileList | null): Promise<string[]> => {
  if (!fileList || fileList.length === 0) return [];
  const selectedFiles = Array.from(fileList)
    .filter((file) => file.type.startsWith('image/'))
    .slice(0, MAX_SCREENSHOTS);
  const dataUrls = await Promise.all(selectedFiles.map((file) => fileToDataUrl(file)));
  return dataUrls.filter(Boolean);
};

const uploadScreenshotsToSupabase = async (fileList: FileList | null, itineraryId: string): Promise<string[]> => {
  if (!fileList || fileList.length === 0) return [];
  const selectedFiles = Array.from(fileList)
    .filter((file) => file.type.startsWith('image/'))
    .filter((file) => file.size <= MAX_SCREENSHOT_SIZE_MB * 1024 * 1024)
    .slice(0, MAX_SCREENSHOTS);

  if (selectedFiles.length === 0) return [];

  if (!isSupabaseConfigured()) {
    return filesToDataUrls(fileList);
  }

  const uploadedUrls: string[] = [];
  for (const file of selectedFiles) {
    const extension = file.name.split('.').pop() || 'jpg';
    const path = `${itineraryId}/${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}.${extension}`;
    const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type
    });

    if (error) {
      console.error('Screenshot upload failed', error);
      continue;
    }

    const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) {
      uploadedUrls.push(normalizeMediaUrl(data.publicUrl));
    }
  }

  return uploadedUrls;
};

export const Draft = ({
  itinerary,
  onItineraryChange
}: {
  itinerary: Itinerary;
  onItineraryChange?: (itinerary: Itinerary) => void;
}) => {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [time, setTime] = useState('');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [day, setDay] = useState<number>(itinerary.days[0]?.day ?? 1);
  const [type, setType] = useState<ActivityType>('other');
  const [editingDraft, setEditingDraft] = useState<DraftItem | null>(null);
  const [readingDraft, setReadingDraft] = useState<DraftItem | null>(null);
  const [readerMode, setReaderMode] = useState<'rednote' | 'image' | null>(null);
  const [readingImageUrl, setReadingImageUrl] = useState<string | null>(null);
  const [isDraftSyncAvailable, setIsDraftSyncAvailable] = useState(true);
  const [useItineraryDraftStore, setUseItineraryDraftStore] = useState(false);
  const clientIdRef = useRef('draft-client-pending');
  const fallbackHydratedRef = useRef(false);
  const storageKey = `drafts-${itinerary.id}`;
  const fallbackDraftStoreId = `drafts-${itinerary.id}`;
  const [drafts, setDrafts] = useState<DraftItem[]>(() => {
    return safeParseDrafts(localStorage.getItem(storageKey));
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drafts));
    } catch (error) {
      console.error('Failed to persist drafts, retrying with optimized media', error);
      try {
        const withoutInlineMedia = drafts.map(stripInlineMediaFromDraft);
        localStorage.setItem(storageKey, JSON.stringify(withoutInlineMedia));
      } catch (secondError) {
        console.error('Failed to persist drafts after optimization', secondError);
      }
    }
  }, [drafts, storageKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      const incoming = safeParseDrafts(event.newValue);
      setDrafts((prev) => (JSON.stringify(prev) === JSON.stringify(incoming) ? prev : incoming));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey]);

  useEffect(() => {
    const existingClientId = sessionStorage.getItem('draft-client-id');
    if (existingClientId) {
      clientIdRef.current = existingClientId;
      return;
    }
    const newClientId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `draft-client-${new Date().toISOString()}`;
    clientIdRef.current = newClientId;
    sessionStorage.setItem('draft-client-id', newClientId);
  }, []);

  const toDraftRecord = (item: DraftItem) => ({
    id: item.id,
    itinerary_id: itinerary.id,
    data: {
      name: item.name,
      link: item.link,
      note: item.note,
      day: item.day,
      time: item.time,
      type: item.type,
      isRedNote: item.isRedNote,
      previewTitle: item.previewTitle,
      previewText: item.previewText,
      thumbnailUrl: item.thumbnailUrl && !isDataUrl(item.thumbnailUrl) ? normalizeMediaUrl(item.thumbnailUrl) : undefined,
      screenshotUrls: (item.screenshotUrls || [])
        .filter((url) => !isDataUrl(url))
        .map((url) => normalizeMediaUrl(url))
        .filter(Boolean)
    },
    updated_at: item.updatedAt || new Date().toISOString(),
    client_id: clientIdRef.current
  });

  const fromDraftRecord = (record: { id: string; data: Record<string, unknown> | null; updated_at: string | null }): DraftItem => ({
    id: record.id,
    name: typeof record.data?.name === 'string' ? record.data.name : '',
    link: typeof record.data?.link === 'string' ? record.data.link : '',
    note: typeof record.data?.note === 'string' ? record.data.note : '',
    day: Number(record.data?.day || 1),
    time: typeof record.data?.time === 'string' ? record.data.time : '',
    type: (record.data?.type as ActivityType) || 'other',
    isRedNote: !!record.data?.isRedNote,
    previewTitle: typeof record.data?.previewTitle === 'string' ? record.data.previewTitle : undefined,
    previewText: typeof record.data?.previewText === 'string' ? record.data.previewText : undefined,
    thumbnailUrl: typeof record.data?.thumbnailUrl === 'string' ? normalizeMediaUrl(record.data.thumbnailUrl) : undefined,
    screenshotUrls: Array.isArray(record.data?.screenshotUrls)
      ? record.data?.screenshotUrls
          .filter((url): url is string => typeof url === 'string')
          .map((url) => normalizeMediaUrl(url))
          .filter(Boolean)
      : [],
    updatedAt: record.updated_at || new Date().toISOString()
  });

  const upsertDraftRemote = async (item: DraftItem) => {
    if (!isSupabaseConfigured() || !isDraftSyncAvailable) return;
    const { error } = await supabase.from('draft_items').upsert(toDraftRecord(item));
    if (error) {
      if (error.code === '42P01' || error.code === '42703' || error.code === '42501') {
        setIsDraftSyncAvailable(false);
        setUseItineraryDraftStore(true);
      }
      console.error('Error syncing draft item:', error);
    }
  };

  const deleteDraftRemote = async (id: string) => {
    if (!isSupabaseConfigured() || !isDraftSyncAvailable) return;
    const { error } = await supabase.from('draft_items').delete().eq('id', id).eq('itinerary_id', itinerary.id);
    if (error) {
      if (error.code === '42P01' || error.code === '42703' || error.code === '42501') {
        setIsDraftSyncAvailable(false);
        setUseItineraryDraftStore(true);
      }
      console.error('Error deleting draft item:', error);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured() || !isDraftSyncAvailable) return;

    let active = true;

    const fetchDrafts = async () => {
      const { data, error } = await supabase
        .from('draft_items')
        .select('*')
        .eq('itinerary_id', itinerary.id)
        .order('updated_at', { ascending: false });

      if (!active) return;

      if (error) {
        if (error.code === '42P01' || error.code === '42703' || error.code === '42501') {
          setIsDraftSyncAvailable(false);
          setUseItineraryDraftStore(true);
        }
        console.error('Error fetching drafts:', error);
        return;
      }

      const remoteDrafts = sortDraftsNewestFirst(data ? data.map(fromDraftRecord) : []);
      const remoteIds = new Set(remoteDrafts.map((item) => item.id));
      setDrafts((prev) => (JSON.stringify(prev) === JSON.stringify(remoteDrafts) ? prev : remoteDrafts));
      setEditingDraft((prev) => (prev && remoteIds.has(prev.id) ? prev : null));
      setReadingDraft((prev) => (prev && remoteIds.has(prev.id) ? prev : null));
    };

    fetchDrafts();
    const pollId = setInterval(fetchDrafts, 15000);

    const channel = supabase
      .channel(`draft-items-${itinerary.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draft_items', filter: `itinerary_id=eq.${itinerary.id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = String(payload.old?.id || '');
            if (!deletedId) return;
            setDrafts((prev) => prev.filter((item) => item.id !== deletedId));
            setEditingDraft((prev) => (prev?.id === deletedId ? null : prev));
            setReadingDraft((prev) => (prev?.id === deletedId ? null : prev));
            return;
          }

          const incomingRaw = payload.new as { id: string; data: Record<string, unknown> | null; updated_at: string | null; client_id?: string };
          if (!incomingRaw?.id) return;
          if (incomingRaw.client_id && incomingRaw.client_id === clientIdRef.current) return;

          const incoming = fromDraftRecord(incomingRaw);
          setDrafts((prev) => {
            const existing = prev.find((item) => item.id === incoming.id);
            if (existing && !isIncomingNewerOrEqual(incoming.updatedAt, existing.updatedAt)) {
              return prev;
            }
            if (existing) {
              return sortDraftsNewestFirst(prev.map((item) => (item.id === incoming.id ? incoming : item)));
            }
            return sortDraftsNewestFirst([incoming, ...prev]);
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(pollId);
      channel.unsubscribe();
    };
  }, [itinerary.id, isDraftSyncAvailable]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !useItineraryDraftStore) return;
    let active = true;
    fallbackHydratedRef.current = false;

    const fetchFallbackDrafts = async () => {
      const { data, error } = await supabase
        .from('itineraries')
        .select('data')
        .eq('id', fallbackDraftStoreId)
        .single();

      if (!active) return;
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching fallback drafts:', error);
        return;
      }

      const items = Array.isArray(data?.data?.items) ? (data?.data?.items as DraftItem[]) : [];
      const normalizedItems = sortDraftsNewestFirst(
        items.map((item) => ({
          ...item,
          screenshotUrls: (item.screenshotUrls || []).map((url) => normalizeMediaUrl(url)).filter(Boolean),
          thumbnailUrl: item.thumbnailUrl ? normalizeMediaUrl(item.thumbnailUrl) : item.thumbnailUrl,
          updatedAt: item.updatedAt || new Date().toISOString()
        }))
      );
      setDrafts((prev) => (JSON.stringify(prev) === JSON.stringify(normalizedItems) ? prev : normalizedItems));
      fallbackHydratedRef.current = true;
    };

    fetchFallbackDrafts();
    const pollId = setInterval(fetchFallbackDrafts, 15000);

    const channel = supabase
      .channel(`fallback-drafts-${itinerary.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itineraries', filter: `id=eq.${fallbackDraftStoreId}` },
        (payload) => {
          const payloadData = payload.new && 'data' in payload.new ? payload.new.data : null;
          const items = Array.isArray(payloadData?.items) ? (payloadData.items as DraftItem[]) : [];
          const normalizedItems = sortDraftsNewestFirst(
            items.map((item) => ({
              ...item,
              screenshotUrls: (item.screenshotUrls || []).map((url) => normalizeMediaUrl(url)).filter(Boolean),
              thumbnailUrl: item.thumbnailUrl ? normalizeMediaUrl(item.thumbnailUrl) : item.thumbnailUrl,
              updatedAt: item.updatedAt || new Date().toISOString()
            }))
          );
          setDrafts((prev) => (JSON.stringify(prev) === JSON.stringify(normalizedItems) ? prev : normalizedItems));
        }
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(pollId);
      channel.unsubscribe();
    };
  }, [fallbackDraftStoreId, itinerary.id, useItineraryDraftStore]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !useItineraryDraftStore || !fallbackHydratedRef.current) return;
    const timeoutId = setTimeout(async () => {
      const payload = {
        items: drafts.map((item) => stripInlineMediaFromDraft(item))
      };
      const { error } = await supabase
        .from('itineraries')
        .upsert({ id: fallbackDraftStoreId, data: payload, updated_at: new Date().toISOString() });
      if (error) {
        console.error('Error syncing fallback drafts:', error);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [drafts, fallbackDraftStoreId, useItineraryDraftStore]);

  const updateDraftPreview = async (id: string, linkValue: string) => {
    const normalized = toSafeHttpLink(linkValue);
    if (!isRedNoteLink(normalized)) {
      const syncAt = new Date().toISOString();
      setDrafts((prev) => {
        const updatedItems = prev.map((item) =>
          item.id === id
            ? { ...item, isRedNote: false, previewTitle: undefined, previewText: undefined, thumbnailUrl: undefined, updatedAt: syncAt }
            : item
        );
        const updatedItem = updatedItems.find((item) => item.id === id);
        if (updatedItem) {
          void upsertDraftRemote(updatedItem);
        }
        return updatedItems;
      });
      return;
    }

    let previewTitle = '';
    let previewText = '';
    let thumbnailUrl = '';

    try {
      const noEmbedResponse = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(normalized)}`);
      if (noEmbedResponse.ok) {
        const data = await noEmbedResponse.json();
        previewTitle = typeof data.title === 'string' ? data.title : '';
        previewText = typeof data.author_name === 'string' ? `By ${data.author_name}` : '';
        thumbnailUrl = typeof data.thumbnail_url === 'string' ? normalizeMediaUrl(data.thumbnail_url) : '';
      }
    } catch (error) {
      console.error('Failed to load RedNote noembed preview', error);
    }

    if (!previewTitle || !thumbnailUrl || !previewText) {
      try {
        const textResponse = await fetch(getJinaProxyUrl(normalized));
        if (textResponse.ok) {
          const markdown = await textResponse.text();
          const titleMatch = markdown.match(/^Title:\s*(.+)$/m) || markdown.match(/^#\s+(.+)$/m);
          const imageMatch = markdown.match(/https?:\/\/[^\s)]+?\.(?:jpg|jpeg|png|webp)/i);
          const cleanedLines = markdown
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('http') && !line.startsWith('Title:') && !line.startsWith('URL Source:'));
          const snippet = cleanedLines.join(' ').replace(/\s+/g, ' ').slice(0, 260);
          if (!previewTitle && titleMatch) previewTitle = titleMatch[1].trim();
          if (!thumbnailUrl && imageMatch) thumbnailUrl = normalizeMediaUrl(imageMatch[0].trim());
          if (!previewText && snippet) previewText = snippet;
        }
      } catch (error) {
        console.error('Failed to load RedNote proxy preview', error);
      }
    }

    const syncAt = new Date().toISOString();
    setDrafts((prev) => {
      const updatedItems = prev.map((item) =>
        item.id === id
          ? {
              ...item,
              isRedNote: true,
              previewTitle: previewTitle || item.name,
              previewText: previewText || item.note || 'Preview unavailable from source. Open link to read full post.',
              thumbnailUrl,
              updatedAt: syncAt
            }
          : item
      );
      const updatedItem = updatedItems.find((item) => item.id === id);
      if (updatedItem) {
        void upsertDraftRemote(updatedItem);
      }
      return updatedItems;
    });
  };

  const addDraft = () => {
    if (!name.trim()) return;
    const normalizedLink = toSafeHttpLink(link.trim());
    const redNote = isRedNoteLink(normalizedLink);
    const newDraft: DraftItem = {
      id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: name.trim(),
      link: normalizedLink,
      note: note.trim(),
      day,
      time: time.trim(),
      type,
      isRedNote: redNote,
      screenshotUrls: screenshots.map((url) => normalizeMediaUrl(url)).filter(Boolean),
      updatedAt: new Date().toISOString()
    };
    setDrafts((prev) => sortDraftsNewestFirst([newDraft, ...prev]));
    void upsertDraftRemote(newDraft);
    if (redNote && normalizedLink) {
      void updateDraftPreview(newDraft.id, normalizedLink);
    }
    setName('');
    setLink('');
    setNote('');
    setTime('');
    setScreenshots([]);
    setType('other');
  };

  const removeDraft = (id: string, options?: { skipConfirm?: boolean }) => {
    const targetDraft = drafts.find((item) => item.id === id);
    if (!options?.skipConfirm) {
      const confirmed = window.confirm(`Delete draft "${targetDraft?.name || 'this item'}"?`);
      if (!confirmed) return;
    }
    setDrafts((prev) => prev.filter((item) => item.id !== id));
    void deleteDraftRemote(id);
    if (editingDraft?.id === id) {
      setEditingDraft(null);
    }
  };

  const startEditDraft = (item: DraftItem) => {
    setEditingDraft(item);
  };

  const cancelEditDraft = () => {
    setEditingDraft(null);
  };

  const saveEditDraft = () => {
    if (!editingDraft || !editingDraft.name.trim()) return;
    const normalizedLink = toSafeHttpLink(editingDraft.link.trim());
    const redNote = isRedNoteLink(normalizedLink);
    const editedId = editingDraft.id;
    const syncAt = new Date().toISOString();
    const updatedDraft: DraftItem = {
      ...editingDraft,
      name: editingDraft.name.trim(),
      link: normalizedLink,
      note: editingDraft.note.trim(),
      time: editingDraft.time.trim(),
      isRedNote: redNote,
      previewTitle: redNote ? editingDraft.previewTitle : undefined,
      previewText: redNote ? editingDraft.previewText : undefined,
      thumbnailUrl: redNote ? editingDraft.thumbnailUrl : undefined,
      screenshotUrls: (editingDraft.screenshotUrls || []).map((url) => normalizeMediaUrl(url)).filter(Boolean),
      updatedAt: syncAt
    };
    setDrafts((prev) => prev.map((item) => (item.id === editedId ? updatedDraft : item)));
    void upsertDraftRemote(updatedDraft);
    if (redNote && normalizedLink) {
      void updateDraftPreview(editedId, normalizedLink);
    }
    setEditingDraft(null);
  };

  const addScreenshotsToNewDraft = async (fileList: FileList | null) => {
    const uploadedUrls = await uploadScreenshotsToSupabase(fileList, itinerary.id);
    if (uploadedUrls.length === 0) return;
    setScreenshots((prev) => [...prev, ...uploadedUrls].slice(0, MAX_SCREENSHOTS));
  };

  const addScreenshotsToEditingDraft = async (fileList: FileList | null) => {
    if (!editingDraft) return;
    const uploadedUrls = await uploadScreenshotsToSupabase(fileList, itinerary.id);
    if (uploadedUrls.length === 0) return;
    setEditingDraft((prev) => {
      if (!prev) return prev;
      const merged = [...(prev.screenshotUrls || []), ...uploadedUrls].slice(0, MAX_SCREENSHOTS);
      return { ...prev, screenshotUrls: merged };
    });
  };

  const finalizeDraft = (item: DraftItem) => {
    const updatedItinerary: Itinerary = {
      ...itinerary,
      days: itinerary.days.map((plan) => {
        if (plan.day !== item.day) return plan;
        const detail = [item.note, item.link ? `Link: ${item.link}` : ''].filter(Boolean).join(' | ');
        return {
          ...plan,
          activities: [
            ...plan.activities,
            {
              time: item.time,
              name: item.name,
              description: detail || 'Added from draft',
              type: item.type
            }
          ]
        };
      })
    };
    onItineraryChange?.(updatedItinerary);
    localStorage.setItem(`itinerary-${itinerary.id}`, JSON.stringify(updatedItinerary));
    removeDraft(item.id, { skipConfirm: true });
  };

  const openRedNoteReader = (item: DraftItem) => {
    setReadingDraft(item);
    setReaderMode('rednote');
    setReadingImageUrl(null);
  };

  const openImageViewer = (item: DraftItem, imageUrl: string) => {
    setReadingDraft(item);
    setReaderMode('image');
    setReadingImageUrl(imageUrl);
  };

  const closeReader = () => {
    setReadingDraft(null);
    setReaderMode(null);
    setReadingImageUrl(null);
  };

  return (
    <div className="space-y-8 md:space-y-12">
      <div className="text-center space-y-4 mb-2 md:mb-4">
        <span className="eyebrow">The draft book · ideas &amp; finds</span>
        <h2
          className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight"
          style={{ color: 'var(--ink)' }}
        >
          Scraps &amp; <span className="font-display-italic" style={{ color: 'var(--accent)' }}>shortlists.</span>
        </h2>
        <p className="max-w-2xl mx-auto text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          A loose pile of places we spotted on Rednote, TikTok, and friends' maps. Pin, tag, and pull the good ones into the itinerary.
        </p>
      </div>
      <div className="editorial-card p-5 md:p-7 space-y-4">
        <span className="eyebrow">Add a new idea</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Place or idea name"
            className="editorial-input"
          />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link (Google Maps, TikTok, Rednote, etc.)"
            className="editorial-input"
          />
          <ThemedSelect
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="editorial-input"
          >
            {itinerary.days.map((plan) => (
              <option key={plan.day} value={plan.day}>
                Day {plan.day} · {plan.city}
              </option>
            ))}
          </ThemedSelect>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="Time (optional)"
              className="editorial-input"
            />
            <ThemedSelect
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType)}
              className="editorial-input"
            >
              {activityTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </ThemedSelect>
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add quick notes, must-try items, budget, reminders..."
          className="editorial-input"
        />
        <div className="space-y-2">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <ImagePlus className="w-4 h-4" />
            Screenshots
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              await addScreenshotsToNewDraft(e.target.files);
              e.currentTarget.value = '';
            }}
            className="w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-slate-200 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-200 file:font-semibold"
          />
          {screenshots.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {screenshots.map((url, index) => (
                <div key={url + index} className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                  <img src={url} alt={`Screenshot ${index + 1}`} referrerPolicy="no-referrer" className="w-full h-20 object-cover" />
                  <button
                    onClick={() => setScreenshots((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={addDraft}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500 text-white font-semibold hover:bg-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!name.trim()}
        >
          <Plus className="w-4 h-4" />
          Save Draft
        </button>
      </div>

      <div className="space-y-3">
        {drafts.length === 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
            No drafts yet. Save your first idea above.
          </div>
        )}
        {drafts.map((item) => (
          <div key={item.id} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 p-4 md:p-5 shadow-sm space-y-3">
            {editingDraft?.id === item.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={editingDraft.name}
                    onChange={(e) => setEditingDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    placeholder="Place or idea name"
                    className="editorial-input"
                  />
                  <input
                    value={editingDraft.link}
                    onChange={(e) => setEditingDraft((prev) => (prev ? { ...prev, link: e.target.value } : prev))}
                    placeholder="Link"
                    className="editorial-input"
                  />
                  <ThemedSelect
                    value={editingDraft.day}
                    onChange={(e) => setEditingDraft((prev) => (prev ? { ...prev, day: Number(e.target.value) } : prev))}
                    className="editorial-input"
                  >
                    {itinerary.days.map((plan) => (
                      <option key={plan.day} value={plan.day}>
                        Day {plan.day} · {plan.city}
                      </option>
                    ))}
                  </ThemedSelect>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      value={editingDraft.time}
                      onChange={(e) => setEditingDraft((prev) => (prev ? { ...prev, time: e.target.value } : prev))}
                      placeholder="Time (optional)"
                      className="editorial-input"
                    />
                    <ThemedSelect
                      value={editingDraft.type}
                      onChange={(e) => setEditingDraft((prev) => (prev ? { ...prev, type: e.target.value as ActivityType } : prev))}
                      className="editorial-input"
                    >
                      {activityTypes.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </ThemedSelect>
                  </div>
                </div>
                <textarea
                  value={editingDraft.note}
                  onChange={(e) => setEditingDraft((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
                  rows={3}
                  placeholder="Add quick notes..."
                  className="editorial-input"
                />
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    <ImagePlus className="w-4 h-4" />
                    Screenshots
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      await addScreenshotsToEditingDraft(e.target.files);
                      e.currentTarget.value = '';
                    }}
                    className="w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-slate-200 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-200 file:font-semibold"
                  />
                  {(editingDraft.screenshotUrls || []).length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {(editingDraft.screenshotUrls || []).map((url, index) => (
                        <div key={url + index} className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                          <img src={url} alt={`Draft screenshot ${index + 1}`} referrerPolicy="no-referrer" className="w-full h-20 object-cover" />
                          <button
                            onClick={() =>
                              setEditingDraft((prev) => {
                                if (!prev) return prev;
                                return { ...prev, screenshotUrls: (prev.screenshotUrls || []).filter((_, i) => i !== index) };
                              })
                            }
                            className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                  <button
                    onClick={saveEditDraft}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!editingDraft.name.trim()}
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={cancelEditDraft}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 dark:text-white">{item.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Day {item.day} · {item.type} {item.time ? `· ${item.time}` : ''}
                    </p>
                    {item.isRedNote && (
                      <span className="inline-flex mt-2 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/30 text-[10px] font-semibold text-rose-600 dark:text-rose-300">
                        RedNote
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEditDraft(item)}
                      className="p-2.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeDraft(item.id)}
                      className="p-2.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {item.isRedNote && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 overflow-hidden">
                    {item.thumbnailUrl && (
                      <img src={item.thumbnailUrl} alt={item.previewTitle || item.name} referrerPolicy="no-referrer" className="w-full h-36 sm:h-44 object-cover" />
                    )}
                    <div className="p-3 space-y-2">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {item.previewTitle || item.name}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-4 whitespace-pre-wrap">
                        {item.previewText || 'Loading preview...'}
                      </p>
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                        <button
                          onClick={() => openRedNoteReader(item)}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 transition-opacity"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          Read Post
                        </button>
                        <a
                          href={toSafeHttpLink(item.link)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Source
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                {item.link && (
                  <a
                    href={toSafeHttpLink(item.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    <LinkIcon className="w-4 h-4" />
                    {item.link}
                  </a>
                )}
                {(item.screenshotUrls || []).length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {(item.screenshotUrls || []).map((url, index) => (
                      <button
                        key={url + index}
                        onClick={() => openImageViewer(item, url)}
                        className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
                      >
                        <img src={url} alt={`Draft screenshot ${index + 1}`} referrerPolicy="no-referrer" className="w-full h-20 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                {item.note && <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{item.note}</p>}
                <button
                  onClick={() => finalizeDraft(item)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Finalize to Itinerary
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {readingDraft && readerMode && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-1.5 sm:p-4">
          <div className="w-full max-w-5xl h-[96dvh] sm:h-auto sm:max-h-[90vh] bg-white dark:bg-slate-900 rounded-lg sm:rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <h3 className="text-sm md:text-base font-bold text-slate-900 dark:text-white line-clamp-1">
                {readerMode === 'image' ? `${readingDraft.name} · Image` : (readingDraft.previewTitle || readingDraft.name)}
              </h3>
              <button
                onClick={closeReader}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {readerMode === 'image' ? (
              <div className="h-[calc(96dvh-57px)] sm:h-[75vh] bg-slate-100 dark:bg-slate-800/40 flex items-center justify-center p-2 sm:p-4">
                {readingImageUrl ? (
                  <img
                    src={readingImageUrl}
                    alt={readingDraft.name}
                    referrerPolicy="no-referrer"
                    className="max-w-full max-h-full object-contain rounded-lg"
                  />
                ) : (
                  <div className="text-sm text-slate-500 dark:text-slate-300">Image unavailable.</div>
                )}
              </div>
            ) : (
              <div className="h-[calc(96dvh-57px)] sm:h-[75vh] bg-slate-100 dark:bg-slate-800/40 flex flex-col">
                <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90">
                  <a
                    href={toSafeHttpLink(readingDraft.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open in RedNote
                  </a>
                </div>
                <div className="flex-1 min-h-0">
                  <iframe
                    src={toSafeHttpLink(readingDraft.link)}
                    title={readingDraft.previewTitle || readingDraft.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
