import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, CheckSquare, Square, Trash2, RefreshCw, Package, ClipboardList, CalendarDays, Layers, Edit2, Save, X } from 'lucide-react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { loadFromStorage, saveToStorage } from '../lib/storageResilience';
import { hapticTap } from '../lib/haptics';

type Category = 'Packing' | 'Pre-trip' | 'Daily';

interface ChecklistItem {
  id: string;
  text: string;
  category: Category;
  completed: boolean;
  isCustom?: boolean;
}

const CategoryIcon = ({ category, className }: { category: Category | 'All', className?: string }) => {
  switch (category) {
    case 'Packing': return <Package className={className} />;
    case 'Pre-trip': return <ClipboardList className={className} />;
    case 'Daily': return <CalendarDays className={className} />;
    default: return <Layers className={className} />;
  }
};

const initialItems: ChecklistItem[] = [];

export const Checklist = () => {
  const [items, setItems] = useState<ChecklistItem[]>(initialItems);
  const [activeCategory, setActiveCategory] = useState<Category | 'All'>('All');
  const [newItemText, setNewItemText] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<Category>('Packing');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingCategory, setEditingCategory] = useState<Category>('Packing');
  const checklistSyncReadyRef = useRef(false);
  const hasLocalChecklistRef = useRef(false);

  // Load checklist from Supabase/LocalStorage
  useEffect(() => {
    checklistSyncReadyRef.current = false;
    hasLocalChecklistRef.current = false;
    // 1. Try local storage first for instant load
    const saved = loadFromStorage<ChecklistItem[]>('checklist-data');
    if (saved) {
      setItems(saved);
      hasLocalChecklistRef.current = true;
    }

    // 2. Sync with Supabase if configured
    if (isSupabaseConfigured()) {
      const fetchChecklist = async () => {
        const { data, error } = await supabase
          .from('checklists')
          .select('data')
          .eq('id', 'default') // Assuming single shared checklist for now, or use itinerary ID
          .single();

        if (data && data.data) {
          // Check if remote data is different to avoid unnecessary re-renders
          setItems(prev => {
            if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
              saveToStorage('checklist-data', data.data);
              return data.data;
            }
            return prev;
          });
          hasLocalChecklistRef.current = true;
          checklistSyncReadyRef.current = true;
        } else if (error && error.code === 'PGRST116') {
          checklistSyncReadyRef.current = true;
        } else if (error && error.code !== 'PGRST116') {
          console.error('Error fetching checklist:', error);
        }
      };
      fetchChecklist();

      // Real-time subscription
      const subscription = supabase
        .channel('checklists')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'checklists', filter: 'id=eq.default' }, (payload) => {
          const nextPayload = payload.new as { data?: ChecklistItem[] } | null;
          if (nextPayload?.data) {
            const newData = nextPayload.data;
            setItems(prev => {
              // Deep comparison to prevent loops
              if (JSON.stringify(prev) !== JSON.stringify(newData)) {
                saveToStorage('checklist-data', newData);
                return newData;
              }
              return prev;
            });
          }
        })
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
    checklistSyncReadyRef.current = true;
  }, []); // Empty dependency array is fine here because we use functional state update

  // Save changes to Supabase/LocalStorage
  useEffect(() => {
    if (!checklistSyncReadyRef.current) return;
    // Save to local storage immediately
    saveToStorage('checklist-data', items);
    if (!hasLocalChecklistRef.current && JSON.stringify(items) === JSON.stringify(initialItems)) return;
    hasLocalChecklistRef.current = true;

    // Sync to Supabase with debounce
    if (isSupabaseConfigured()) {
      const syncToSupabase = async () => {
        const { error } = await supabase
          .from('checklists')
          .upsert({ id: 'default', data: items, updated_at: new Date().toISOString() });
        
        if (error) console.error('Error syncing checklist:', error);
      };

      const timeoutId = setTimeout(syncToSupabase, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [items]);

  const categories: (Category | 'All')[] = ['All', 'Packing', 'Pre-trip', 'Daily'];

  const toggleItem = (id: string) => {
    hapticTap();
    setItems(items.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const deleteItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
    if (editingItemId === id) {
      setEditingItemId(null);
      setEditingText('');
    }
  };

  const addItem = () => {
    if (!newItemText.trim()) return;
    const newItem: ChecklistItem = {
      id: Date.now().toString(),
      text: newItemText,
      category: newItemCategory,
      completed: false,
      isCustom: true
    };
    setItems([newItem, ...items]);
    setNewItemText('');
  };

  const startEditItem = (item: ChecklistItem) => {
    setEditingItemId(item.id);
    setEditingText(item.text);
    setEditingCategory(item.category);
  };

  const saveEditItem = (id: string) => {
    const nextText = editingText.trim();
    if (!nextText) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, text: nextText, category: editingCategory }
          : item
      )
    );
    setEditingItemId(null);
    setEditingText('');
  };

  const cancelEditItem = () => {
    setEditingItemId(null);
    setEditingText('');
  };

  const resetProgress = () => {
    if (window.confirm('Are you sure you want to reset all progress?')) {
      setItems(items.map(item => ({ ...item, completed: false })));
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => activeCategory === 'All' || item.category === activeCategory);
  }, [items, activeCategory]);

  const progress = Math.round((items.filter(i => i.completed).length / items.length) * 100) || 0;

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4 mb-6 md:mb-10">
        <span className="eyebrow">The checklist · small things to remember</span>
        <h2
          className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight"
          style={{ color: 'var(--ink)' }}
        >
          Bits to <span className="font-display-italic" style={{ color: 'var(--accent)' }}>pack.</span>
        </h2>
        <p className="max-w-2xl mx-auto text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Pre-trip chores, daily reminders, and everything that needs to fit in the suitcase.
        </p>
      </div>

      {/* Progress Bar */}
      <div className="editorial-card p-5 md:p-7 transition-colors duration-300">
        <div className="flex justify-between items-baseline gap-2 mb-4">
          <span className="eyebrow">Progress</span>
          <span className="font-display text-4xl md:text-5xl leading-none" style={{ color: 'var(--accent)' }}>
            {progress}<span className="text-2xl md:text-3xl" style={{ color: 'var(--ink-muted)' }}>%</span>
          </span>
        </div>
        <div className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%`, backgroundColor: 'var(--accent)' }}
          ></div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-slate-900 p-5 md:p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-6 transition-colors duration-300">
        <div className="flex flex-col md:flex-row justify-between gap-6">
          {/* Filters */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filter by Category</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={clsx(
                    "px-3 py-2 md:px-4 md:py-2.5 rounded-3xl text-xs md:text-sm font-medium transition-all flex items-center gap-1.5 md:gap-2",
                    activeCategory === cat
                      ? "bg-emerald-500 dark:bg-emerald-600 text-white shadow-md"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  )}
                >
                  <CategoryIcon category={cat} className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Add Item */}
          <div className="space-y-3 flex-1">
             <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Add Custom Item</label>
             <div className="flex flex-col sm:flex-row gap-2 min-w-0">
               <input 
                 type="text" 
                 value={newItemText}
                 onChange={(e) => setNewItemText(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && addItem()}
                 placeholder="Add new checklist item..."
                 className="editorial-input flex-1 min-w-0"
               />
               <div className="flex gap-2">
                 <select
                   value={newItemCategory}
                   onChange={(e) => setNewItemCategory(e.target.value as Category)}
                   className="editorial-input flex-1 sm:flex-none"
                 >
                   <option value="Packing">Packing</option>
                   <option value="Pre-trip">Pre-trip</option>
                   <option value="Daily">Daily</option>
                 </select>
                 <button 
                   onClick={addItem}
                   className="p-2.5 bg-emerald-500 dark:bg-emerald-600 text-white rounded-3xl hover:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors"
                 >
                   <Plus className="w-5 h-5" />
                 </button>
               </div>
             </div>
          </div>
        </div>
        
        <div className="flex justify-end pt-2 border-t border-slate-50 dark:border-slate-800">
           <button 
             onClick={resetProgress}
             className="text-xs md:text-sm text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1 transition-colors px-2 py-1"
           >
             <RefreshCw className="w-3.5 h-3.5" /> Reset to defaults
           </button>
        </div>
      </div>

      {/* Checklist Grid */}
      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
        }}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <AnimatePresence mode="popLayout">
          {filteredItems.map(item => (
            <motion.div
              layout
              key={item.id}
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0 }
              }}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, scale: 0.95 }}
              className={clsx(
                "p-3 md:p-4 rounded-3xl border transition-all flex items-start gap-3 md:gap-4 group cursor-pointer select-none relative",
                item.completed 
                  ? "bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/50" 
                  : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-sm"
              )}
              onClick={() => {
                if (editingItemId === item.id) return;
                toggleItem(item.id);
              }}
            >
              <div className={clsx(
                "w-5 h-5 md:w-6 md:h-6 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 mt-0.5",
                item.completed ? "bg-emerald-500 dark:bg-emerald-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600"
              )}>
                {item.completed ? <CheckSquare className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Square className="w-3.5 h-3.5 md:w-4 md:h-4" />}
              </div>
              
              <div className="flex-1 min-w-0">
                {editingItemId === item.id ? (
                  <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="editorial-input is-compact"
                    />
                    <select
                      value={editingCategory}
                      onChange={(e) => setEditingCategory(e.target.value as Category)}
                      className="editorial-input is-compact"
                    >
                      <option value="Packing">Packing</option>
                      <option value="Pre-trip">Pre-trip</option>
                      <option value="Daily">Daily</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEditItem(item.id)}
                        className="px-2.5 py-1.5 text-xs rounded-xl bg-emerald-500 text-white inline-flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        onClick={cancelEditItem}
                        className="px-2.5 py-1.5 text-xs rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className={clsx(
                      "font-medium transition-all text-sm md:text-base mb-1.5",
                      item.completed ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-700 dark:text-slate-300"
                    )}>
                      {item.text}
                    </p>
                    <span className={clsx(
                      "text-[10px] md:text-xs px-2 py-0.5 rounded-xl border inline-flex items-center gap-1 md:gap-1.5",
                      item.category === 'Packing' && "bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 border-blue-100 dark:border-blue-900/50",
                      item.category === 'Pre-trip' && "bg-purple-50 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400 border-purple-100 dark:border-purple-900/50",
                      item.category === 'Daily' && "bg-amber-50 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400 border-amber-100 dark:border-amber-900/50"
                    )}>
                      <CategoryIcon category={item.category} className="w-3 h-3" />
                      {item.category}
                    </span>
                  </>
                )}
              </div>

              <div className="md:opacity-0 md:group-hover:opacity-100 flex items-center gap-1 transition-all absolute top-2 right-2 md:static">
                {editingItemId !== item.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditItem(item);
                    }}
                    className="p-1.5 md:p-2 text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                  className="p-1.5 md:p-2 text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
      
      {filteredItems.length === 0 && (
         <div className="text-center py-12">
           <p className="text-slate-400 dark:text-slate-500">No checklist items yet. Add your first one to get started.</p>
         </div>
      )}
    </div>
  );
};
