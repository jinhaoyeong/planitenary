import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Trash2, ImagePlus, Upload, Camera, Edit3, Check } from 'lucide-react';
import { useSwipe } from '../hooks/useSwipe';
import type { DayPhoto } from '../data';
import { savePhoto, getPhotos, deletePhoto, updatePhotoCaption, subscribeToPhotoChanges } from '../lib/photoStorage';
import { Skeleton } from './ui/Skeleton';

interface PhotoGalleryProps {
  itineraryId: string;
  dayNumber: number;
  dayTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export const PhotoGallery = ({
  itineraryId,
  dayNumber,
  dayTitle,
  isOpen,
  onClose,
}: PhotoGalleryProps) => {
  const [photos, setPhotos] = useState<DayPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedPhotos = await getPhotos(itineraryId, dayNumber);
      setPhotos(loadedPhotos);
    } catch (error) {
      console.error('Failed to load photos:', error);
    } finally {
      setIsLoading(false);
    }
  }, [itineraryId, dayNumber]);

  // Load photos when gallery opens
  useEffect(() => {
    if (isOpen) {
      loadPhotos();
    }
  }, [isOpen, loadPhotos]);

  // Subscribe to real-time photo changes
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = subscribeToPhotoChanges(itineraryId, () => {
      // Reload photos when changes are detected from other devices
      loadPhotos();
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, itineraryId, loadPhotos]);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((file) =>
      file.type.startsWith('image/')
    );

    if (validFiles.length === 0) return;

    setUploadProgress(0);
    const totalFiles = validFiles.length;

    for (let i = 0; i < validFiles.length; i++) {
      try {
        await savePhoto(itineraryId, dayNumber, validFiles[i]);
        setUploadProgress(((i + 1) / totalFiles) * 100);
      } catch (error) {
        console.error('Failed to upload photo:', error);
      }
    }

    await loadPhotos();
    setTimeout(() => setUploadProgress(null), 500);
  }, [itineraryId, dayNumber, loadPhotos]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await deletePhoto(itineraryId, dayNumber, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      if (selectedPhotoIndex !== null) {
        const deletedIndex = photos.findIndex((p) => p.id === photoId);
        if (deletedIndex <= selectedPhotoIndex) {
          setSelectedPhotoIndex(Math.max(0, selectedPhotoIndex - 1));
        }
        if (photos.length === 1) {
          setSelectedPhotoIndex(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete photo:', error);
    }
  };

  const handleSaveCaption = async (photoId: string) => {
    try {
      await updatePhotoCaption(itineraryId, dayNumber, photoId, captionText);
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, caption: captionText } : p))
      );
      setEditingCaptionId(null);
    } catch (error) {
      console.error('Failed to update caption:', error);
    }
  };

  const navigatePhoto = useCallback((direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;
    if (direction === 'prev') {
      setSelectedPhotoIndex(selectedPhotoIndex === 0 ? photos.length - 1 : selectedPhotoIndex - 1);
    } else {
      setSelectedPhotoIndex(selectedPhotoIndex === photos.length - 1 ? 0 : selectedPhotoIndex + 1);
    }
  }, [selectedPhotoIndex, photos.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedPhotoIndex === null) return;
      if (e.key === 'ArrowLeft') navigatePhoto('prev');
      if (e.key === 'ArrowRight') navigatePhoto('next');
      if (e.key === 'Escape') {
        if (editingCaptionId) {
          setEditingCaptionId(null);
        } else {
          setSelectedPhotoIndex(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhotoIndex, editingCaptionId, navigatePhoto]);

  // Lock body scroll when modal or lightbox is open
  useEffect(() => {
    if (isOpen || selectedPhotoIndex !== null) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, selectedPhotoIndex]);

  const selectedPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;

  useEffect(() => {
    if (selectedPhotoIndex === null) return;
    if (photos.length === 0) {
      setSelectedPhotoIndex(null);
      return;
    }
    if (selectedPhotoIndex > photos.length - 1) {
      setSelectedPhotoIndex(photos.length - 1);
    }
  }, [photos.length, selectedPhotoIndex]);

  if (typeof document === 'undefined') return null;

  const { onTouchStart, onTouchMove, onTouchEnd } = useSwipe({
    onSwipeLeft: () => navigatePhoto('next'),
    onSwipeRight: () => navigatePhoto('prev'),
    onSwipeDown: () => setSelectedPhotoIndex(null),
    onSwipeUp: () => setSelectedPhotoIndex(null),
    threshold: 40
  });

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/90 dark:bg-slate-950/95 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full h-full md:w-[95vw] md:h-[90vh] md:max-w-6xl md:max-h-[90vh] bg-white dark:bg-slate-900 md:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header - Fixed at top with safe area */}
            <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 md:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3 md:py-4 border-b border-slate-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30 flex-shrink-0">
                  <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base sm:text-lg md:text-xl font-bold text-slate-900 dark:text-white truncate">
                    Day {dayNumber}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
                    {dayTitle}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-all flex-shrink-0 ml-2"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {/* Upload Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative mb-4 sm:mb-6 p-4 sm:p-6 md:p-8 border-2 border-dashed rounded-xl sm:rounded-2xl cursor-pointer
                  transition-all duration-300
                  ${isDragging
                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-500/10'
                    : 'border-slate-200 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                />

                {uploadProgress !== null ? (
                  <div className="flex flex-col items-center gap-2 sm:gap-3">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center">
                      <Upload className="w-5 h-5 sm:w-7 sm:h-7 text-rose-500 animate-pulse" />
                    </div>
                    <div className="w-32 sm:w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${uploadProgress}%` }}
                        className="h-full bg-gradient-to-r from-rose-500 to-pink-500 rounded-full"
                      />
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                      Uploading... {Math.round(uploadProgress)}%
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 sm:gap-3">
                    <div className={`
                      w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center
                      transition-all duration-300
                      ${isDragging
                        ? 'bg-rose-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                      }
                    `}>
                      <ImagePlus className="w-5 h-5 sm:w-7 sm:h-7" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
                        {isDragging ? 'Drop to upload' : 'Add photos to this day'}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">
                        Drag & drop or click to select
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Photo Grid */}
              {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3 md:gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full" />
                  ))}
                </div>
              ) : photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-center">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3 sm:mb-4">
                    <Camera className="w-6 h-6 sm:w-8 sm:h-8 text-slate-300 dark:text-slate-600" />
                  </div>
                  <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 font-medium">No photos yet</p>
                  <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 mt-1">
                    Upload your first photo for this day
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3 md:gap-4">
                  {photos.map((photo, index) => (
                    <motion.div
                      key={photo.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.03 }}
                      className="group relative aspect-square rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 active:scale-95"
                      onClick={() => setSelectedPhotoIndex(index)}
                    >
                      <img
                        src={photo.dataUrl}
                        alt={photo.caption || `Photo ${index + 1}`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                      />
                      {/* Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                      {/* Caption preview */}
                      {photo.caption && (
                        <div className="absolute bottom-0 left-0 right-0 p-1.5 sm:p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <p className="text-[10px] sm:text-xs text-white truncate">{photo.caption}</p>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Photo Count Badge - Fixed at bottom with safe area */}
            {photos.length > 0 && (
              <div className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 sm:left-4 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-slate-900/80 dark:bg-white/10 backdrop-blur-sm rounded-full">
                <span className="text-[10px] sm:text-xs font-medium text-white">
                  {photos.length} photo{photos.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </motion.div>

          {/* Lightbox */}
          {typeof document !== 'undefined' && createPortal(
            <AnimatePresence>
              {selectedPhoto && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
                  onClick={() => setEditingCaptionId(null)}
                >
                {/* Close button */}
                <button
                  onClick={() => setSelectedPhotoIndex(null)}
                  className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 sm:right-4 z-10 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Navigation - Previous */}
                {photos.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigatePhoto('prev');
                    }}
                    className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all"
                  >
                    <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                )}

                {/* Image */}
                <motion.div
                  key={selectedPhoto.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  className="relative max-w-[94vw] max-h-[62vh] sm:max-w-[90vw] sm:max-h-[75vh] flex items-center justify-center overflow-hidden touch-pan-x touch-pan-y"
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                >
                  <img
                    src={selectedPhoto.dataUrl}
                    alt={selectedPhoto.caption || 'Photo'}
                    className="max-w-full max-h-[62vh] sm:max-h-[75vh] object-contain rounded-lg shadow-2xl pointer-events-auto touch-pan-x touch-pan-y"
                  />
                </motion.div>

                {/* Navigation - Next */}
                {photos.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigatePhoto('next');
                    }}
                    className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all"
                  >
                    <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                )}

                {/* Bottom Controls */}
                <div
                  className="absolute bottom-0 left-0 right-0 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] px-3 sm:px-4 md:px-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="max-w-3xl mx-auto">
                    {/* Caption */}
                    {editingCaptionId === selectedPhoto.id ? (
                      <div className="flex items-center gap-2 mb-3 sm:mb-4">
                        <input
                          type="text"
                          value={captionText}
                          onChange={(e) => setCaptionText(e.target.value)}
                          placeholder="Add a caption..."
                          className="flex-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveCaption(selectedPhoto.id)}
                          className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-rose-500 flex items-center justify-center text-white hover:bg-rose-600 active:scale-95 transition-all"
                        >
                          <Check className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
                        <p
                          className="text-white/80 text-xs sm:text-sm cursor-pointer hover:text-white transition-colors flex items-center gap-1.5 sm:gap-2 min-w-0 truncate"
                          onClick={() => {
                            setEditingCaptionId(selectedPhoto.id);
                            setCaptionText(selectedPhoto.caption || '');
                          }}
                        >
                          {selectedPhoto.caption || (
                            <span className="flex items-center gap-1.5 sm:gap-2 text-white/50 hover:text-white/80">
                              <Edit3 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              Add caption
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-white/50 text-xs sm:text-sm">
                        {selectedPhotoIndex! + 1} / {photos.length}
                      </div>
                      <button
                        onClick={() => handleDeletePhoto(selectedPhoto.id)}
                        className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 active:scale-95 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span className="text-xs sm:text-sm font-medium">Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>, document.body)}
        </motion.div>
      )}
    </AnimatePresence>, document.body
  );
};
