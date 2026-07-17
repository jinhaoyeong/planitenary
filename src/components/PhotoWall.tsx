import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSwipe } from '../hooks/useSwipe';
import { X, ChevronLeft, ChevronRight, Trash2, Plus, ImagePlus, Edit3, Check, Camera } from 'lucide-react';
import { ThemedSelect } from './ui/ThemedSelect';
import type { Itinerary, DayPhoto } from '../data';
import { getAllPhotosForItinerary, savePhoto, deletePhoto, updatePhotoCaption, subscribeToPhotoChanges } from '../lib/photoStorage';
import { clsx } from 'clsx';

interface Props {
  itinerary: Itinerary;
}

interface FlatPhoto {
  photo: DayPhoto;
  dayNumber: number;
  dayDate: string;
  dayCity: string;
}

// Minimal skeleton for loading state
function Skeleton({ className }: { className?: string }) {
  return (
    <div 
      className={clsx("animate-pulse rounded-2xl", className)}
      style={{ backgroundColor: 'var(--border)' }}
    />
  );
}

export function PhotoWall({ itinerary }: Props) {
  const [photosByDay, setPhotosByDay] = useState<Record<number, DayPhoto[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDayNumber, setSelectedDayNumber] = useState<number>(1);
  const [caption, setCaption] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAllPhotos = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await getAllPhotosForItinerary(itinerary.id);
      setPhotosByDay(all);
    } catch (e) {
      console.error('Failed to load photos:', e);
    } finally {
      setIsLoading(false);
    }
  }, [itinerary.id]);

  useEffect(() => {
    loadAllPhotos();
  }, [loadAllPhotos]);

  useEffect(() => {
    const unsub = subscribeToPhotoChanges(itinerary.id, loadAllPhotos);
    return () => unsub?.();
  }, [itinerary.id, loadAllPhotos]);

  // Flatten for lightbox navigation
  const flatPhotos: FlatPhoto[] = [];
  const sortedDayNumbers = Object.keys(photosByDay)
    .map(Number)
    .sort((a, b) => a - b);

  for (const dayNum of sortedDayNumbers) {
    const day = itinerary.days.find((d) => d.day === dayNum);
    const photos = photosByDay[dayNum] || [];
    for (const photo of photos) {
      flatPhotos.push({
        photo,
        dayNumber: dayNum,
        dayDate: day?.date ?? '',
        dayCity: day?.city ?? '',
      });
    }
  }

  const totalPhotos = flatPhotos.length;
  const currentLightbox = lightboxIndex !== null ? flatPhotos[lightboxIndex] : null;

  // Add photo flow
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => file.type.startsWith('image/'));
    if (files.length === 0) return;
    
    const newFiles = [...selectedFiles, ...files].slice(0, 25);
    
    setSelectedFiles(newFiles);
    
    // Revoke old URLs to prevent memory leaks
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls(newFiles.map(file => URL.createObjectURL(file)));
  };

  const handleSavePhoto = async () => {
    if (selectedFiles.length === 0) return;
    setIsSaving(true);
    try {
      // Save all photos sequentially to avoid overloading storage/db at once
      for (const file of selectedFiles) {
        await savePhoto(itinerary.id, selectedDayNumber, file, caption || undefined);
      }
      await loadAllPhotos();
      resetAddModal();
    } catch (e) {
      console.error('Failed to save photo:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const resetAddModal = () => {
    setShowAddModal(false);
    setSelectedFiles([]);
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls([]);
    setCaption('');
    setSelectedDayNumber(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSelectedFile = (index: number) => {
    const newFiles = [...selectedFiles];
    newFiles.splice(index, 1);
    setSelectedFiles(newFiles);
    
    const newUrls = [...previewUrls];
    URL.revokeObjectURL(newUrls[index]);
    newUrls.splice(index, 1);
    setPreviewUrls(newUrls);
  };

  const handleDelete = async () => {
    if (!currentLightbox) return;
    if (!window.confirm('Delete this photo?')) return;
    await deletePhoto(itinerary.id, currentLightbox.dayNumber, currentLightbox.photo.id);
    setLightboxIndex(null);
    loadAllPhotos();
  };

  const handleSaveCaption = async () => {
    if (!currentLightbox) return;
    await updatePhotoCaption(itinerary.id, currentLightbox.dayNumber, currentLightbox.photo.id, captionDraft);
    setEditingCaption(false);
    loadAllPhotos();
  };

  // Keyboard nav for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
      if (e.key === 'ArrowRight' && lightboxIndex < flatPhotos.length - 1) setLightboxIndex(lightboxIndex + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, flatPhotos.length]);

  // Day info for the selected day in add-modal
  const selectedDay = itinerary.days.find((d) => d.day === selectedDayNumber);

  // Lock body scroll when modal or lightbox is open
  useEffect(() => {
    if (showAddModal || currentLightbox) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showAddModal, currentLightbox]);

  const { onTouchStart, onTouchMove, onTouchEnd } = useSwipe({
    onSwipeLeft: () => {
      if (lightboxIndex !== null && lightboxIndex < flatPhotos.length - 1) {
        setLightboxIndex(lightboxIndex + 1);
      }
    },
    onSwipeRight: () => {
      if (lightboxIndex !== null && lightboxIndex > 0) {
        setLightboxIndex(lightboxIndex - 1);
      }
    },
    onSwipeDown: () => setLightboxIndex(null),
    onSwipeUp: () => setLightboxIndex(null),
    threshold: 40
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2
            className="font-display text-3xl sm:text-4xl md:text-5xl tracking-tight"
            style={{ color: 'var(--ink)' }}
          >
            Photo wall.
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
            {totalPhotos} {totalPhotos === 1 ? 'photo' : 'photos'} across {sortedDayNumbers.length} {sortedDayNumbers.length === 1 ? 'day' : 'days'}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="pill-btn pill-primary shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add photo
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && totalPhotos === 0 && (
        <div
          className="text-center py-20 px-4 rounded-3xl border"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        >
          <Camera className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>No photos yet</p>
          <p className="text-sm mt-1">Add your first trip photo to start building the wall.</p>
        </div>
      )}

      {/* Photo grid grouped by day */}
      {!isLoading && sortedDayNumbers.map((dayNum) => {
        const day = itinerary.days.find((d) => d.day === dayNum);
        const photos = photosByDay[dayNum] || [];
        if (photos.length === 0) return null;

        return (
          <section key={dayNum} className="space-y-3">
            {/* Day header */}
            <div className="flex items-baseline gap-3">
              <span
                className="font-display text-2xl md:text-3xl"
                style={{ color: 'var(--accent)' }}
              >
                Day {dayNum}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>
                {day?.date} · {day?.city}
              </span>
            </div>

            {/* Masonry-ish grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
              {photos.map((photo) => {
                const flatIdx = flatPhotos.findIndex((f) => f.photo.id === photo.id);
                return (
                  <motion.button
                    key={photo.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="relative aspect-square rounded-2xl overflow-hidden group cursor-pointer"
                    style={{ border: '1px solid var(--border)' }}
                    onClick={() => setLightboxIndex(flatIdx)}
                  >
                    <img
                      src={photo.dataUrl}
                      alt={photo.caption || ''}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                    {photo.caption && (
                      <div
                        className="absolute inset-x-0 bottom-0 p-2 text-xs font-medium truncate opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--ink) 70%, transparent)',
                          color: 'var(--bg-elevated)',
                        }}
                      >
                        {photo.caption}
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Add Photo Modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showAddModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <button
                className="absolute inset-0 w-full h-full cursor-default"
                style={{ backgroundColor: 'color-mix(in srgb, var(--ink) 60%, transparent)' }}
                onClick={resetAddModal}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-full max-w-md rounded-3xl p-5 sm:p-6 space-y-5 overflow-y-auto overscroll-contain max-h-full"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-lift)',
                }}
              >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl" style={{ color: 'var(--ink)' }}>
                  Add a photo
                </h3>
                <button onClick={resetAddModal} className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ color: 'var(--ink-muted)' }}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* File picker */}
              {previewUrls.length === 0 ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-video rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    border: '2px dashed var(--border)',
                    color: 'var(--ink-muted)',
                  }}
                >
                  <ImagePlus className="w-8 h-8" />
                  <span className="text-sm font-medium">Choose photos (up to 25)</span>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1">
                    {previewUrls.map((url, idx) => (
                      <div key={url} className="relative aspect-square rounded-xl overflow-hidden group">
                        <img src={url} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover bg-black/5 dark:bg-white/5" />
                        <button
                          onClick={() => removeSelectedFile(idx)}
                          className="absolute top-1 right-1 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-md bg-black/50 hover:bg-black/70"
                          style={{ color: 'white' }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {previewUrls.length < 25 && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="relative aspect-square rounded-xl border-2 border-dashed flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                      >
                        <Plus className="w-6 h-6" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
                    {previewUrls.length} of 25 selected
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* Day selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Which day?
                </label>
                <ThemedSelect
                  value={selectedDayNumber}
                  onChange={(e) => setSelectedDayNumber(Number(e.target.value))}
                  className="editorial-input w-full bg-transparent border rounded-xl px-3 py-2"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  {itinerary.days.map((day) => (
                    <option key={day.day} value={day.day}>
                      Day {day.day} — {day.date} · {day.city}
                    </option>
                  ))}
                </ThemedSelect>
              </div>

              {/* Activity selector (optional) */}
              {selectedDay && selectedDay.activities.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    During which activity? <span className="font-normal">(optional — goes into caption)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDay.activities.map((act, i) => {
                      const isSelected = caption.includes(act.name);
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            if (isSelected) {
                              setCaption(prev => prev.replace(` · ${act.name}`, '').replace(`${act.name} · `, '').replace(act.name, '').trim());
                            } else {
                              setCaption((prev) => prev ? `${prev} · ${act.name}` : act.name);
                            }
                          }}
                          className={clsx(
                            'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                            isSelected
                              ? 'border-[var(--accent)] text-[color:var(--accent)]'
                              : 'border-[var(--border)] text-[color:var(--ink-muted)]',
                          )}
                          style={isSelected
                            ? { backgroundColor: 'var(--accent-soft)' }
                            : { backgroundColor: 'transparent' }
                          }
                        >
                          {act.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Caption */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Caption
                </label>
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="What's happening here?"
                  className="editorial-input w-full bg-transparent border rounded-xl px-3 py-2"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
              </div>

              {/* Save */}
              <button
                onClick={handleSavePhoto}
                disabled={selectedFiles.length === 0 || isSaving}
                className="w-full pill-btn pill-primary justify-center mt-2 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : `Save ${selectedFiles.length > 0 ? selectedFiles.length : ''} to Wall`}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}

      {/* Lightbox */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {currentLightbox && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 sm:p-8"
              style={{ backgroundColor: 'color-mix(in srgb, var(--ink) 95%, transparent)' }}
            >
              {/* Top Bar */}
              <div className="absolute top-0 inset-x-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] flex items-center justify-between z-10" style={{ color: 'var(--bg)' }}>
                <div className="flex flex-col drop-shadow-md">
                <span className="font-display text-xl">Day {currentLightbox.dayNumber}</span>
                <span className="text-xs opacity-80">{currentLightbox.dayDate} · {currentLightbox.dayCity}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    handleDelete();
                  }}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setLightboxIndex(null)}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Prev/Next Buttons */}
            {lightboxIndex! > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex! - 1); }}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-2 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              >
                <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
            )}
            {lightboxIndex! < flatPhotos.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex! + 1); }}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-2 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              >
                <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
            )}

            {/* Image */}
            <motion.div
              key={currentLightbox.photo.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="relative max-w-5xl w-full max-h-[80vh] flex items-center justify-center overflow-hidden touch-pan-x touch-pan-y"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <img
                src={currentLightbox.photo.dataUrl}
                alt={currentLightbox.photo.caption || `Day ${currentLightbox.dayNumber} photo`}
                className="max-w-full max-h-[80vh] object-contain rounded-lg drop-shadow-2xl pointer-events-auto touch-pan-x touch-pan-y"
              />
            </motion.div>

            {/* Caption Bar */}
            <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-center z-10">
              <div className="w-full max-w-2xl bg-black/40 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                {editingCaption ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      placeholder="Add a caption..."
                      className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/50"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveCaption();
                        if (e.key === 'Escape') setEditingCaption(false);
                      }}
                    />
                    <button
                      onClick={handleSaveCaption}
                      className="p-2 rounded-xl bg-white text-black hover:bg-white/90 transition-colors flex items-center justify-center aspect-square"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 text-white">
                    <p className="text-sm sm:text-base leading-relaxed">
                      {currentLightbox.photo.caption || <span className="opacity-50 italic">No caption</span>}
                    </p>
                    <button
                      onClick={() => {
                        setCaptionDraft(currentLightbox.photo.caption || '');
                        setEditingCaption(true);
                      }}
                      className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors shrink-0"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
