import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  X,
  FileImage,
  Loader2,
  ExternalLink,
  Paperclip,
  ChevronDown,
  ChevronRight,
  Folder,
  Edit2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { SkeletonCard } from './ui/Skeleton';

const BUCKET = 'trip-documents';

export interface TripDocumentRow {
  id: string;
  title: string;
  description: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  created_at: string;
  updated_at: string;
}

function publicUrlForPath(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function isPdfMime(mime: string): boolean {
  return mime === 'application/pdf';
}

export interface ParsedFile {
  path: string;
  name: string;
  type: string;
}

export interface DocumentData {
  category: string;
  files: ParsedFile[];
}

export function parseDocumentData(row: TripDocumentRow): DocumentData {
  let category = 'General';
  let files: ParsedFile[] = [];

  try {
    if (row.storage_path.startsWith('{')) {
      const parsed = JSON.parse(row.storage_path);
      if (parsed.files && Array.isArray(parsed.files)) {
        return { category: parsed.category || 'General', files: parsed.files };
      }
    } else if (row.storage_path.startsWith('[')) {
      const parsed = JSON.parse(row.storage_path);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].path) {
        files = parsed;
      }
    }
  } catch (e) {
    // ignore
  }

  if (files.length === 0) {
    files = [{
      path: row.storage_path,
      name: row.file_name,
      type: row.mime_type
    }];
  }

  return { category, files };
}

export const Documents = () => {
  const [rows, setRows] = useState<TripDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ row: TripDocumentRow; fileIndex: number } | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [editingRow, setEditingRow] = useState<TripDocumentRow | null>(null);
  const [existingFiles, setExistingFiles] = useState<ParsedFile[]>([]);
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Custom categories added during this session that aren't yet saved to DB
  const [sessionCategories, setSessionCategories] = useState<string[]>([]);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const existingCategories = useMemo(() => {
    const cats = new Set<string>(['Hotel', 'Transport', 'Flight', 'Ticket', 'General', ...sessionCategories]);
    rows.forEach(r => cats.add(parseDocumentData(r).category));
    return Array.from(cats).sort();
  }, [rows, sessionCategories]);

  const groupedRows = useMemo(() => {
    const groups: Record<string, TripDocumentRow[]> = {};
    rows.forEach(row => {
      const cat = parseDocumentData(row).category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(row);
    });
    return groups;
  }, [rows]);

  const fetchRows = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setFetchError(null);
    const { data, error } = await supabase
      .from('trip_documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      setFetchError('Could not load documents. Check Supabase table and policies.');
      setRows([]);
    } else {
      setRows((data as TripDocumentRow[]) || []);
    }
    setLoading(false);
  }, [configured]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    if (!configured) return;
    const channel = supabase
      .channel('trip-documents-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_documents' },
        () => {
          void fetchRows();
        }
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [configured, fetchRows]);

  const resetForm = () => {
    setTitle('');
    setCategory('General');
    setDescription('');
    setFiles([]);
    setExistingFiles([]);
    setEditingRow(null);
    setIsAddingNewCategory(false);
    setNewCategoryName('');
    setIsDropdownOpen(false);
  };

  const handleEditClick = (row: TripDocumentRow) => {
    const data = parseDocumentData(row);
    setTitle(row.title);
    setCategory(data.category);
    setDescription(row.description);
    setEditingRow(row);
    setFiles([]);
    setIsAddingNewCategory(false);
    setNewCategoryName('');
    setIsDropdownOpen(false);
    // Filter out the empty placeholder file if there are no actual files
    const validFiles = data.files.filter(f => f.path && f.path.trim() !== '');
    setExistingFiles(validFiles);
    setShowForm(false); // We close the top form if open
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured || !title.trim()) return;
    
    setSaving(true);
    try {
      const uploadedFiles: ParsedFile[] = [];

      // If new files were selected, upload them
      if (files.length > 0) {
        for (const file of files) {
          const safeName = file.name.replace(/[^\w.-]/g, '_').slice(0, 120) || 'attachment';
          const path = `${crypto.randomUUID()}/${safeName}`;

          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || undefined,
          });
          
          if (upErr) {
            window.alert(upErr.message || `Upload failed for ${file.name}.`);
            return;
          }

          uploadedFiles.push({
            path,
            name: file.name,
            type: file.type || 'application/octet-stream',
          });
        }
      }

      // Combine remaining existing files with newly uploaded ones
      let finalFiles = [...existingFiles, ...uploadedFiles];

      if (finalFiles.length === 0) {
        // Allow creating empty document without throwing error or breaking structure
        finalFiles = [{ path: '', name: '', type: '' }];
      }

      const finalCategory = isAddingNewCategory && newCategoryName.trim() ? newCategoryName.trim() : category;

      const docData = {
        category: finalCategory || 'General',
        files: finalFiles
      };

      if (isAddingNewCategory && newCategoryName.trim() && !existingCategories.includes(newCategoryName.trim())) {
        setSessionCategories(prev => [...prev, newCategoryName.trim()]);
      }

      if (editingRow) {
        const { error: updErr } = await supabase.from('trip_documents')
          .update({
            title: title.trim(),
            description: description.trim(),
            storage_path: JSON.stringify(docData),
            file_name: finalFiles.length === 1 ? finalFiles[0].name : (finalFiles.length === 0 || !finalFiles[0].path ? 'No files' : `${finalFiles.length} files`),
            mime_type: finalFiles.length === 1 ? finalFiles[0].type : 'application/json',
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRow.id);

        if (updErr) {
          window.alert(updErr.message || 'Could not update document.');
          return;
        }

        // Cleanup files that were removed during edit
        const originalFiles = parseDocumentData(editingRow).files.filter(f => f.path && f.path.trim() !== '');
        const keptFilePaths = new Set(existingFiles.map(f => f.path));
        const filesToDelete = originalFiles.filter(f => !keptFilePaths.has(f.path));
        
        if (filesToDelete.length > 0) {
          await supabase.storage.from(BUCKET).remove(filesToDelete.map(f => f.path));
        }

      } else {
        const { error: insErr } = await supabase.from('trip_documents').insert({
          title: title.trim(),
          description: description.trim(),
          storage_path: JSON.stringify(docData),
          file_name: finalFiles.length === 1 ? finalFiles[0].name : (finalFiles.length === 0 || !finalFiles[0].path ? 'No files' : `${finalFiles.length} files`),
          mime_type: finalFiles.length === 1 ? finalFiles[0].type : 'application/json',
          updated_at: new Date().toISOString(),
        });
        if (insErr) {
          if (uploadedFiles.length > 0) {
            await supabase.storage.from(BUCKET).remove(uploadedFiles.map(f => f.path));
          }
          window.alert(insErr.message || 'Could not save document row.');
          return;
        }
      }

      resetForm();
      setShowForm(false);
      await fetchRows();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: TripDocumentRow) => {
    if (!configured) return;
    const ok = window.confirm(`Remove “${row.title}” for everyone?`);
    if (!ok) return;
    setDeletingId(row.id);
    try {
      const parsedFiles = parseDocumentData(row).files;
      if (parsedFiles.length > 0 && parsedFiles[0].path) {
        await supabase.storage.from(BUCKET).remove(parsedFiles.map(f => f.path));
      }
      
      const { error } = await supabase.from('trip_documents').delete().eq('id', row.id);
      if (error) {
        window.alert(error.message || 'Delete failed.');
        return;
      }
      setViewer((v) => (v?.row.id === row.id ? null : v));
      await fetchRows();
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteCategory = async (catToDelete: string) => {
    if (window.confirm(`Delete folder "${catToDelete}"? This will delete ALL documents inside it for everyone.`)) {
      const rowsToDelete = groupedRows[catToDelete] || [];
      if (rowsToDelete.length > 0) {
        for (const row of rowsToDelete) {
           await handleDelete(row);
        }
      }
      setSessionCategories(prev => prev.filter(c => c !== catToDelete));
      if (category === catToDelete) {
        setCategory('General');
      }
    }
  };

  const viewerFile = useMemo(() => {
    if (!viewer) return null;
    const parsed = parseDocumentData(viewer.row).files;
    return parsed[viewer.fileIndex] || null;
  }, [viewer]);

  const viewerUrl = useMemo(
    () => (viewerFile ? publicUrlForPath(viewerFile.path) : ''),
    [viewerFile]
  );

  const renderForm = (isInline: boolean = false) => (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      onSubmit={handleAdd}
      className={clsx("overflow-hidden", isInline ? "mt-4" : "mb-8")}
      style={{ marginTop: isInline ? undefined : 0 }}
    >
      <div
        className={clsx("editorial-card rounded-2xl space-y-4 border", isInline ? "p-3 sm:p-4" : "p-4 sm:p-6")}
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
      >
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Title
          </label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Hotel booking, rail pass, visa copy"
            className="w-full rounded-xl px-3 py-3 text-base border outline-none focus:ring-2 transition-shadow"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--ink)',
              boxShadow: 'inset 0 1px 0 rgba(15,14,13,0.04)',
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Category (Folder)
          </label>
          {isAddingNewCategory ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Planning, Tickets, Hotel"
                className="w-full rounded-xl px-3 py-3 text-base border outline-none focus:ring-2 transition-shadow"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--ink)',
                  boxShadow: 'inset 0 1px 0 rgba(15,14,13,0.04)',
                }}
              />
              <button
                type="button"
                onClick={() => setIsAddingNewCategory(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full flex items-center justify-between rounded-xl px-3 py-3 text-base border outline-none focus:ring-2 transition-shadow"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--ink)',
                  boxShadow: 'inset 0 1px 0 rgba(15,14,13,0.04)',
                }}
              >
                <span>{category}</span>
                <ChevronDown className={clsx("w-5 h-5 transition-transform opacity-50", isDropdownOpen && "rotate-180")} />
              </button>
              
              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl border shadow-xl overflow-hidden"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
                  >
                    <div className="py-2">
                      {existingCategories.map(c => (
                        <button
                          key={c}
                          type="button"
                          className="w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between group hover:bg-black/5 dark:hover:bg-white/5"
                          style={{ color: category === c ? 'var(--accent)' : 'var(--ink)' }}
                          onClick={() => {
                            setCategory(c);
                            setIsDropdownOpen(false);
                          }}
                        >
                          <span className={category === c ? "font-semibold" : ""}>{c}</span>
                          {category === c && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />}
                        </button>
                      ))}
                      <div className="h-px w-full my-2 opacity-50" style={{ backgroundColor: 'var(--border)' }} />
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors font-semibold hover:bg-black/5 dark:hover:bg-white/5"
                        style={{ color: 'var(--ink)' }}
                        onClick={() => {
                          setIsAddingNewCategory(true);
                          setIsDropdownOpen(false);
                        }}
                      >
                        + Create New Category...
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes, confirmation numbers, anything helpful…"
            rows={3}
            className="w-full rounded-xl px-3 py-3 text-base border outline-none focus:ring-2 resize-y min-h-[5rem]"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--ink)',
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Attachments (up to 10 PDFs or images)
            <span className="ml-2 lowercase text-[10px] font-normal opacity-70">
              (Optional)
            </span>
          </label>
          <div className="space-y-3">
            <label
              className={clsx(
                "flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer rounded-xl border border-dashed px-4 py-4 transition-colors hover:opacity-95",
                (files.length + existingFiles.length) >= 10 && "opacity-50 pointer-events-none"
              )}
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
            >
              <Paperclip className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {(files.length + existingFiles.length) > 0 ? `Add more files (${files.length + existingFiles.length}/10)` : 'Choose files'}
                </span>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  PDF, JPG, PNG, WebP, or GIF
                </p>
              </div>
              <input
                type="file"
                multiple
                accept="application/pdf,image/*"
                className="sr-only"
                disabled={(files.length + existingFiles.length) >= 10}
                onChange={(e) => {
                  if (!e.target.files) return;
                  const newFiles = Array.from(e.target.files);
                  const totalCount = files.length + existingFiles.length + newFiles.length;
                  if (totalCount > 10) {
                    alert('You can only attach up to 10 files per document.');
                    const allowed = newFiles.slice(0, 10 - (files.length + existingFiles.length));
                    setFiles((prev) => [...prev, ...allowed]);
                  } else {
                    setFiles((prev) => [...prev, ...newFiles]);
                  }
                  e.target.value = '';
                }}
              />
            </label>
            
            {(existingFiles.length > 0 || files.length > 0) && (
              <ul className="space-y-2">
                {existingFiles.map((f, i) => (
                  <li key={`exist-${i}`} className="flex items-center justify-between gap-2 p-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>Existing</span>
                      <span className="truncate" style={{ color: 'var(--ink)' }}>{f.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const ok = window.confirm(`Remove this existing file: ${f.name}? It won't be deleted from the server until you save changes.`);
                        if (ok) {
                          setExistingFiles(existingFiles.filter((_, idx) => idx !== i));
                        }
                      }}
                      className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      aria-label="Remove existing file"
                    >
                      <X className="w-4 h-4" style={{ color: 'var(--ink-muted)' }} />
                    </button>
                  </li>
                ))}
                {files.map((f, i) => (
                  <li key={`new-${i}`} className="flex items-center justify-between gap-2 p-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}>New</span>
                      <span className="truncate" style={{ color: 'var(--ink)' }}>{f.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      aria-label="Remove new file"
                    >
                      <X className="w-4 h-4" style={{ color: 'var(--ink-muted)' }} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="pill-btn pill-primary flex-1 sm:flex-none inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingRow ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />)}
            {editingRow ? 'Save Changes' : 'Save & sync'}
          </button>
          {isInline && (
            <button
              type="button"
              onClick={() => setEditingRow(null)}
              disabled={saving}
              className="pill-btn flex-1 sm:flex-none inline-flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </motion.form>
  );

  if (!configured) {
    return (
      <div className="max-w-2xl mx-auto px-1">
        <div
          className="editorial-card p-6 md:p-8 rounded-2xl border"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex items-start gap-3">
            <FileText className="w-8 h-8 shrink-0" style={{ color: 'var(--accent)' }} />
            <div>
              <h2 className="font-display text-2xl md:text-3xl" style={{ color: 'var(--ink)' }}>
                Documents
              </h2>
              <p className="mt-2 text-sm md:text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Add your Supabase URL and anon key in <code className="text-xs">.env</code>, then run{' '}
                <code className="text-xs">supabase_documents.sql</code> in the Supabase SQL editor to
                create the table, bucket, and sync rules. After that, PDFs and images you upload here
                stay in sync for both of you.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-1 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <span className="eyebrow">Shared with both of you</span>
          <h2 className="mt-2 font-display text-3xl md:text-4xl" style={{ color: 'var(--ink)' }}>
            Documents
          </h2>
          <p className="mt-2 text-sm md:text-base max-w-xl" style={{ color: 'var(--ink-muted)' }}>
            Tickets, visas, hotel PDFs, scans—tap any attachment to view it full screen. Changes sync
            live.
          </p>
        </div>
        <button
            type="button"
            onClick={() => {
              if (showForm) {
                resetForm();
                setShowForm(false);
              } else {
                resetForm();
                setShowForm(true);
              }
            }}
            className="pill-btn pill-primary inline-flex items-center justify-center gap-2 self-start sm:self-auto"
            disabled={!!editingRow}
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? 'Cancel' : 'Add document'}
          </button>
      </div>

      <AnimatePresence>
        {showForm && !editingRow && renderForm(false)}
      </AnimatePresence>

      {fetchError && (
        <p className="text-sm mb-4 px-1" style={{ color: 'var(--warn)' }}>
          {fetchError}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : rows.length === 0 ? (
        <div
          className="text-center py-16 px-4 rounded-2xl border"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        >
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm md:text-base">No documents yet. Add one to share it instantly.</p>
        </div>
      ) : (
        <motion.div 
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.1 }
            }
          }}
          className="space-y-8"
        >
          {Object.keys(groupedRows).sort().map(cat => {
            const isExpanded = expandedCategories[cat] === true; // default false
            const catRows = groupedRows[cat];

            return (
              <motion.div 
                key={cat} 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
                }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between group">
                  <button
                    type="button"
                    onClick={() => setExpandedCategories(p => ({ ...p, [cat]: !isExpanded }))}
                    className="flex flex-1 items-center gap-3 text-left py-2 focus:outline-none"
                  >
                  <div className="p-1.5 rounded-lg transition-colors group-hover:bg-black/5 dark:group-hover:bg-white/5">
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5" style={{ color: 'var(--ink-muted)' }} />
                    ) : (
                      <ChevronRight className="w-5 h-5" style={{ color: 'var(--ink-muted)' }} />
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Folder className="w-6 h-6" style={{ color: 'var(--accent)' }} />
                    <h3 className="font-display text-2xl" style={{ color: 'var(--ink)' }}>{cat}</h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>
                      {catRows.length}
                    </span>
                  </div>
                </button>
                {/* Delete Category Button - Only show if it's a custom category and empty or explicitly allowed to delete */}
                {!['Hotel', 'Transport', 'Flight', 'Ticket', 'General'].includes(cat) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCategory(cat);
                    }}
                    className="p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 text-red-500"
                    aria-label={`Delete ${cat} category`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.ul
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                      variants={{
                        hidden: { opacity: 0, height: 0 },
                        visible: { 
                          opacity: 1, 
                          height: 'auto', 
                          transition: { 
                            height: { duration: 0.3, ease: "easeInOut" },
                            staggerChildren: 0.05 
                          } 
                        }
                      }}
                      className="space-y-3 md:space-y-4 overflow-hidden px-1"
                    >
                      {catRows.map((row) => {
                        const parsedFiles = parseDocumentData(row).files;
                        const firstFile = parsedFiles[0];
                        if (!firstFile) return null;

                        const thumbUrl = publicUrlForPath(firstFile.path);
                        const isImg = isImageMime(firstFile.type);
                        const hasMultiple = parsedFiles.length > 1;

                        return (
                          <motion.li 
                            key={row.id}
                            variants={{
                              hidden: { opacity: 0, y: 20 },
                              visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
                            }}
                          >
                            <AnimatePresence>
                              {editingRow?.id === row.id && renderForm(true)}
                            </AnimatePresence>
                            <div
                              className="editorial-card rounded-2xl border overflow-hidden flex flex-col sm:flex-row"
                              style={{ 
                                borderColor: 'var(--border)', 
                                backgroundColor: 'var(--bg-elevated)',
                                display: editingRow?.id === row.id ? 'none' : undefined
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => firstFile && firstFile.path && setViewer({ row, fileIndex: 0 })}
                                disabled={!firstFile || !firstFile.path}
                                className={clsx(
                                  'relative shrink-0 w-full sm:w-36 h-40 sm:h-auto sm:min-h-[8rem] flex items-center justify-center border-b sm:border-b-0 sm:border-r transition-opacity',
                                  firstFile && firstFile.path ? 'active:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2' : 'opacity-50 cursor-default'
                                )}
                                style={{
                                  borderColor: 'var(--border)',
                                  backgroundColor: 'var(--bg)',
                                }}
                                aria-label={firstFile && firstFile.path ? `Open attachment: ${row.title}` : `No attachment for: ${row.title}`}
                              >
                                {isImg && firstFile && firstFile.path ? (
                                  <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                ) : (
                                  <div className="flex flex-col items-center gap-2 p-4">
                                    <FileText className="w-10 h-10" style={{ color: 'var(--accent)' }} />
                                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                                      {firstFile && firstFile.path ? 'PDF' : 'NO FILE'}
                                    </span>
                                  </div>
                                )}
                                {hasMultiple && firstFile && firstFile.path && (
                                  <span
                                    className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm"
                                    style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                                  >
                                    1/{parsedFiles.length}
                                  </span>
                                )}
                                {firstFile && firstFile.path && (
                                  <span
                                    className="absolute bottom-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full sm:hidden"
                                    style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                                  >
                                    Tap to view
                                  </span>
                                )}
                              </button>
                              <div className="flex-1 p-4 sm:p-5 min-w-0 flex flex-col">
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="font-display text-lg md:text-xl leading-tight pr-2" style={{ color: 'var(--ink)' }}>
                                    {row.title}
                                  </h3>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleEditClick(row)}
                                      disabled={deletingId === row.id}
                                      className="p-2 rounded-xl transition-colors hover:opacity-80 disabled:opacity-40"
                                      style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                                      aria-label="Edit document"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDelete(row)}
                                      disabled={deletingId === row.id}
                                      className="p-2 rounded-xl transition-colors hover:opacity-80 disabled:opacity-40"
                                      style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                                      aria-label="Delete document"
                                    >
                                      {deletingId === row.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-4 h-4" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                {row.description ? (
                                  <p className="mt-2 text-sm md:text-base leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink-muted)' }}>
                                    {row.description}
                                  </p>
                                ) : null}
                                
                                {hasMultiple && firstFile && firstFile.path ? (
                                  <div className="mt-4 space-y-2">
                                    {parsedFiles.map((file, idx) => {
                                      const isFileImg = isImageMime(file.type);
                                      return (
                                        <button
                                          key={idx}
                                          type="button"
                                          onClick={() => setViewer({ row, fileIndex: idx })}
                                          className="flex items-center gap-3 w-full text-left p-2 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                                        >
                                          <div className="shrink-0 p-1.5 rounded-md bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700">
                                            {isFileImg ? <FileImage className="w-4 h-4 text-rose-500" /> : <FileText className="w-4 h-4 text-rose-500" />}
                                          </div>
                                          <span className="text-sm truncate flex-1" style={{ color: 'var(--ink)' }}>{file.name}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <>
                                    {firstFile && firstFile.path ? (
                                      <button
                                        type="button"
                                        onClick={() => setViewer({ row, fileIndex: 0 })}
                                        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold self-start"
                                        style={{ color: 'var(--accent)' }}
                                      >
                                        <FileImage className="w-4 h-4" />
                                        {isImg ? 'View image' : 'View PDF'}
                                      </button>
                                    ) : (
                                      <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium self-start opacity-50" style={{ color: 'var(--ink-muted)' }}>
                                        <FileText className="w-4 h-4" />
                                        No file attached
                                      </div>
                                    )}
                                    {firstFile && firstFile.path && (
                                      <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                                        {firstFile.name}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </motion.li>
                        );
                      })}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <AnimatePresence>
        {viewer && viewerFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex flex-col"
            style={{
              backgroundColor: 'rgba(15,14,13,0.92)',
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div
              className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4 shrink-0 relative z-[100]"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.14)',
                backgroundColor: 'rgba(22, 20, 18, 0.98)',
              }}
            >
              <div className="min-w-0">
                <p className="font-semibold text-sm sm:text-base truncate" style={{ color: '#fafafa' }}>
                  {viewer.row.title}
                  {parseDocumentData(viewer.row).files.length > 1 && (
                    <span className="ml-2 text-xs opacity-70">
                      ({viewer.fileIndex + 1}/{parseDocumentData(viewer.row).files.length})
                    </span>
                  )}
                </p>
                <p className="text-xs truncate" style={{ color: 'rgba(250,250,250,0.55)' }}>
                  {viewerFile.name}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {parseDocumentData(viewer.row).files.length > 1 && (
                  <div className="flex items-center gap-1 mr-2 border-r border-white/20 pr-3">
                    <button
                      type="button"
                      disabled={viewer.fileIndex === 0}
                      onClick={() => setViewer({ ...viewer, fileIndex: viewer.fileIndex - 1 })}
                      className="p-2 rounded-full transition-colors hover:bg-white/15 disabled:opacity-30 disabled:pointer-events-none"
                      style={{ color: '#ffffff' }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    <button
                      type="button"
                      disabled={viewer.fileIndex === parseDocumentData(viewer.row).files.length - 1}
                      onClick={() => setViewer({ ...viewer, fileIndex: viewer.fileIndex + 1 })}
                      className="p-2 rounded-full transition-colors hover:bg-white/15 disabled:opacity-30 disabled:pointer-events-none"
                      style={{ color: '#ffffff' }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  </div>
                )}
                <a
                  href={viewerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-full p-2.5 transition-colors hover:bg-white/15"
                  style={{
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.35)',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                  }}
                  aria-label="Open in new tab"
                >
                  <ExternalLink className="w-5 h-5" strokeWidth={2.25} color="#ffffff" aria-hidden />
                </a>
                <button
                  type="button"
                  onClick={() => setViewer(null)}
                  className="inline-flex items-center justify-center rounded-full p-2.5 transition-colors hover:bg-white/15"
                  style={{
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.45)',
                    backgroundColor: 'rgba(255,255,255,0.12)',
                  }}
                  aria-label="Close viewer"
                >
                  <X className="w-6 h-6" strokeWidth={2.5} color="#ffffff" aria-hidden />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-2 sm:p-4 relative">
              {parseDocumentData(viewer.row).files.length > 1 && (
                <>
                  <button
                    type="button"
                    disabled={viewer.fileIndex === 0}
                    onClick={() => setViewer({ ...viewer, fileIndex: viewer.fileIndex - 1 })}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-0 transition-all z-10 hidden sm:block"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  </button>
                  <button
                    type="button"
                    disabled={viewer.fileIndex === parseDocumentData(viewer.row).files.length - 1}
                    onClick={() => setViewer({ ...viewer, fileIndex: viewer.fileIndex + 1 })}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-0 transition-all z-10 hidden sm:block"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  </button>
                </>
              )}
              {isImageMime(viewerFile.type) ? (
                <img
                  key={viewerUrl}
                  src={viewerUrl}
                  alt={viewer.row.title}
                  className="max-w-full max-h-[calc(100dvh-5.5rem)] w-auto h-auto object-contain"
                />
              ) : isPdfMime(viewerFile.type) ? (
                <iframe
                  key={viewerUrl}
                  title={viewer.row.title}
                  src={viewerUrl}
                  className="w-full h-[calc(100dvh-6rem)] min-h-[70dvh] max-w-5xl rounded-lg bg-white"
                />
              ) : (
                <div className="text-center text-white/80 px-4">
                  <p className="mb-4">Preview is not available for this file type.</p>
                  <a
                    href={viewerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 underline font-semibold"
                  >
                    Open or download <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
