import type { DayPhoto } from '../data';
import { supabase, isSupabaseConfigured } from './supabase';

const DB_NAME = 'china-trip-photos';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

// Maximum dimensions for compressed images
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1920;
const JPEG_QUALITY = 0.8;

// Supabase storage bucket for photos
const PHOTOS_BUCKET = 'day-photos';
const PHOTOS_TABLE = 'day_photos';

let dbInstance: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('dayKey', 'dayKey', { unique: false });
      }
    };
  });
};

interface StoredPhoto {
  key: string; // `${dayKey}-${photoId}`
  dayKey: string; // `${itineraryId}-${dayNumber}`
  photo: DayPhoto;
}

// Database record for Supabase
interface PhotoRecord {
  id: string;
  itinerary_id: string;
  day_number: number;
  caption?: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
}

// Compress image file to base64 data URL
export const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Calculate new dimensions while maintaining aspect ratio
        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG for better compression
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

// Convert data URL to Blob for upload
const dataUrlToBlob = (dataUrl: string): Blob => {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

// Generate unique ID for photos
const generatePhotoId = (): string => {
  return `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Get day key for local storage
const getDayKey = (itineraryId: string, dayNumber: number): string => {
  return `${itineraryId}-${dayNumber}`;
};

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const downloadPhotoDataUrl = async (storagePath: string): Promise<string | null> => {
  try {
    const response = await fetch(storagePath);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await readBlobAsDataUrl(blob);
  } catch {
    return null;
  }
};

// Upload photo to Supabase Storage
const uploadPhotoToStorage = async (
  itineraryId: string,
  dayNumber: number,
  photoId: string,
  file: File | Blob
): Promise<string | null> => {
  if (!isSupabaseConfigured()) return null;

  const extension = file.type.split('/')[1] || 'jpg';
  const path = `${itineraryId}/${dayNumber}/${photoId}.${extension}`;

  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg',
    });

  if (error) {
    console.error('Failed to upload photo to storage:', error);
    return null;
  }

  const { data } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
};

// Delete photo from Supabase Storage
const deletePhotoFromStorage = async (storagePath: string): Promise<void> => {
  if (!isSupabaseConfigured() || !storagePath) return;

  // Extract path from full URL or use path directly
  const path = storagePath.includes('.supabase.co/storage/')
    ? storagePath.split('/storage/v1/object/public/').pop()?.split('?')[0] || storagePath
    : storagePath;

  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
  if (error) {
    console.error('Failed to delete photo from storage:', error);
  }
};

// Save photo metadata to Supabase table
const upsertPhotoRecord = async (record: PhotoRecord): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false;

  const { error } = await supabase.from(PHOTOS_TABLE).upsert(record);
  if (error) {
    // Table might not exist, silently fail
    if (error.code === '42P01' || error.code === '42703' || error.code === '42501') {
      console.warn('Photo sync table not available, using local storage only');
      return false;
    }
    console.error('Failed to sync photo record:', error);
    return false;
  }
  return true;
};

// Delete photo metadata from Supabase table
const deletePhotoRecord = async (
  itineraryId: string,
  dayNumber: number,
  photoId: string
): Promise<void> => {
  if (!isSupabaseConfigured()) return;

  const { error } = await supabase
    .from(PHOTOS_TABLE)
    .delete()
    .eq('id', photoId)
    .eq('itinerary_id', itineraryId)
    .eq('day_number', dayNumber);

  if (error && error.code !== '42P01' && error.code !== '42703' && error.code !== '42501') {
    console.error('Failed to delete photo record:', error);
  }
};

// Fetch photo records from Supabase
export const fetchPhotoRecords = async (
  itineraryId: string,
  dayNumber: number
): Promise<PhotoRecord[]> => {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from(PHOTOS_TABLE)
    .select('*')
    .eq('itinerary_id', itineraryId)
    .eq('day_number', dayNumber)
    .order('created_at', { ascending: true });

  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === '42501') {
      return [];
    }
    console.error('Failed to fetch photo records:', error);
    return [];
  }

  return (data as PhotoRecord[]) || [];
};

// Save a photo for a specific day (with sync)
export const savePhoto = async (
  itineraryId: string,
  dayNumber: number,
  file: File,
  caption?: string
): Promise<DayPhoto> => {
  const db = await openDB();
  const dataUrl = await compressImage(file);
  const photoId = generatePhotoId();
  const dayKey = getDayKey(itineraryId, dayNumber);
  const now = new Date().toISOString();

  const photo: DayPhoto = {
    id: photoId,
    dataUrl,
    caption,
    createdAt: now,
  };

  // Save to local IndexedDB first (for immediate display)
  const storedPhoto: StoredPhoto = {
    key: `${dayKey}-${photoId}`,
    dayKey,
    photo,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(storedPhoto);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Sync to Supabase in background
  if (isSupabaseConfigured()) {
    const blob = dataUrlToBlob(dataUrl);
    const storagePath = await uploadPhotoToStorage(itineraryId, dayNumber, photoId, blob);

    if (storagePath) {
      await upsertPhotoRecord({
        id: photoId,
        itinerary_id: itineraryId,
        day_number: dayNumber,
        caption,
        storage_path: storagePath,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return photo;
};

// Get all photos for a specific day (with sync)
export const getPhotos = async (
  itineraryId: string,
  dayNumber: number
): Promise<DayPhoto[]> => {
  const db = await openDB();
  const dayKey = getDayKey(itineraryId, dayNumber);

  const localStoredPhotos = await new Promise<StoredPhoto[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('dayKey');
    const request = index.getAll(dayKey);

    request.onsuccess = () => {
      resolve(request.result as StoredPhoto[]);
    };
    request.onerror = () => reject(request.error);
  });

  const localPhotoMap = new Map(localStoredPhotos.map((item) => [item.photo.id, item]));

  if (isSupabaseConfigured()) {
    try {
      const remoteRecords = await fetchPhotoRecords(itineraryId, dayNumber);
      const remoteIds = new Set(remoteRecords.map((record) => record.id));

      for (const localPhoto of localStoredPhotos) {
        if (remoteIds.has(localPhoto.photo.id)) continue;
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(localPhoto.key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
        localPhotoMap.delete(localPhoto.photo.id);
      }

      for (const record of remoteRecords) {
        const existing = localPhotoMap.get(record.id);
        if (existing) {
          if (existing.photo.caption !== record.caption || existing.photo.createdAt !== record.created_at) {
            const updatedStoredPhoto: StoredPhoto = {
              ...existing,
              photo: {
                ...existing.photo,
                caption: record.caption,
                createdAt: record.created_at,
              },
            };
            await new Promise<void>((resolve, reject) => {
              const transaction = db.transaction(STORE_NAME, 'readwrite');
              const store = transaction.objectStore(STORE_NAME);
              const request = store.put(updatedStoredPhoto);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });
            localPhotoMap.set(record.id, updatedStoredPhoto);
          }
          continue;
        }

        const dataUrl = await downloadPhotoDataUrl(record.storage_path);
        if (!dataUrl) continue;

        const storedPhoto: StoredPhoto = {
          key: `${dayKey}-${record.id}`,
          dayKey,
          photo: {
            id: record.id,
            dataUrl,
            caption: record.caption,
            createdAt: record.created_at,
          },
        };

        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(storedPhoto);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
        localPhotoMap.set(record.id, storedPhoto);
      }
    } catch (err) {
      console.error('Failed to sync remote photos:', err);
    }
  }

  return Array.from(localPhotoMap.values())
    .map((item) => item.photo)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
};

// Delete a photo (with sync)
export const deletePhoto = async (
  itineraryId: string,
  dayNumber: number,
  photoId: string
): Promise<void> => {
  const db = await openDB();
  const dayKey = getDayKey(itineraryId, dayNumber);
  const key = `${dayKey}-${photoId}`;

  // Get the photo record first to find storage path
  if (isSupabaseConfigured()) {
    const records = await fetchPhotoRecords(itineraryId, dayNumber);
    const record = records.find((r) => r.id === photoId);
    if (record) {
      await deletePhotoFromStorage(record.storage_path);
      await deletePhotoRecord(itineraryId, dayNumber, photoId);
    }
  }

  // Delete from local IndexedDB
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Update photo caption (with sync)
export const updatePhotoCaption = async (
  itineraryId: string,
  dayNumber: number,
  photoId: string,
  caption: string
): Promise<void> => {
  const db = await openDB();
  const dayKey = getDayKey(itineraryId, dayNumber);
  const key = `${dayKey}-${photoId}`;

  // Update local IndexedDB
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(key);

    getRequest.onsuccess = () => {
      const storedPhoto = getRequest.result as StoredPhoto;
      if (storedPhoto) {
        storedPhoto.photo.caption = caption;
        const putRequest = store.put(storedPhoto);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        reject(new Error('Photo not found'));
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });

  // Sync caption update to Supabase
  if (isSupabaseConfigured()) {
    const records = await fetchPhotoRecords(itineraryId, dayNumber);
    const record = records.find((r) => r.id === photoId);
    if (record) {
      await upsertPhotoRecord({
        ...record,
        caption,
        updated_at: new Date().toISOString(),
      });
    }
  }
};

// Get all photos for an itinerary (for backup/export)
export const getAllPhotosForItinerary = async (
  itineraryId: string
): Promise<Record<number, DayPhoto[]>> => {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const result: Record<number, DayPhoto[]> = {};
      const items = request.result as StoredPhoto[];

      items.forEach((item) => {
        if (item.dayKey.startsWith(itineraryId)) {
          const dayNumber = parseInt(item.dayKey.split('-').pop() || '0', 10);
          if (!result[dayNumber]) {
            result[dayNumber] = [];
          }
          result[dayNumber].push(item.photo);
        }
      });

      // Sort photos by creation date
      Object.keys(result).forEach((day) => {
        result[parseInt(day, 10)].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });

      resolve(result);
    };
    request.onerror = () => reject(request.error);
  });
};

export const restorePhotosForItinerary = async (
  itineraryId: string,
  photosByDay: Record<number, DayPhoto[]>
): Promise<void> => {
  const db = await openDB();
  const allItems = await new Promise<StoredPhoto[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as StoredPhoto[]);
    request.onerror = () => reject(request.error);
  });

  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  for (const item of allItems) {
    if (item.dayKey.startsWith(`${itineraryId}-`)) {
      store.delete(item.key);
    }
  }

  for (const [dayNumberRaw, dayPhotos] of Object.entries(photosByDay || {})) {
    const dayNumber = Number(dayNumberRaw);
    const dayKey = getDayKey(itineraryId, dayNumber);
    for (const photo of dayPhotos) {
      store.put({
        key: `${dayKey}-${photo.id}`,
        dayKey,
        photo,
      } as StoredPhoto);
    }
  }

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

// Subscribe to real-time photo changes
export const subscribeToPhotoChanges = (
  itineraryId: string,
  onChange: () => void
): (() => void) => {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const channel = supabase
    .channel(`photos-${itineraryId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: PHOTOS_TABLE,
      },
      (payload) => {
        const rowCandidate = payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old;
        const scopedItineraryId =
          rowCandidate && typeof rowCandidate === 'object' && 'itinerary_id' in rowCandidate
            ? String((rowCandidate as { itinerary_id?: unknown }).itinerary_id ?? '')
            : '';
        if (scopedItineraryId && scopedItineraryId !== itineraryId) {
          return;
        }
        onChange();
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

// Sync all photos from remote (for initial load)
export const syncAllPhotosFromRemote = async (
  itineraryId: string
): Promise<void> => {
  if (!isSupabaseConfigured()) return;

  const db = await openDB();

  // Get all photo records for this itinerary
  const { data, error } = await supabase
    .from(PHOTOS_TABLE)
    .select('*')
    .eq('itinerary_id', itineraryId)
    .order('created_at', { ascending: true });

  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === '42501') {
      return;
    }
    console.error('Failed to sync all photos:', error);
    return;
  }

  const records = (data as PhotoRecord[]) || [];

  // Get existing local photos
  const localPhotos = await new Promise<StoredPhoto[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as StoredPhoto[]);
    request.onerror = () => reject(request.error);
  });

  const localForItinerary = localPhotos.filter((photo) => photo.dayKey.startsWith(`${itineraryId}-`));
  const localMap = new Map(localForItinerary.map((photo) => [photo.key, photo]));
  const remoteMap = new Map<string, PhotoRecord>();

  for (const record of records) {
    const dayKey = getDayKey(itineraryId, record.day_number);
    const key = `${dayKey}-${record.id}`;
    remoteMap.set(key, record);
  }

  for (const local of localForItinerary) {
    if (remoteMap.has(local.key)) continue;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(local.key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    localMap.delete(local.key);
  }

  for (const [key, record] of remoteMap.entries()) {
    const dayKey = getDayKey(itineraryId, record.day_number);
    const existing = localMap.get(key);

    if (existing) {
      if (existing.photo.caption !== record.caption || existing.photo.createdAt !== record.created_at) {
        const updatedStoredPhoto: StoredPhoto = {
          ...existing,
          photo: {
            ...existing.photo,
            caption: record.caption,
            createdAt: record.created_at,
          },
        };
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(updatedStoredPhoto);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
      continue;
    }

    const dataUrl = await downloadPhotoDataUrl(record.storage_path);
    if (!dataUrl) continue;

    const storedPhoto: StoredPhoto = {
      key,
      dayKey,
      photo: {
        id: record.id,
        dataUrl,
        caption: record.caption,
        createdAt: record.created_at,
      },
    };

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(storedPhoto);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
