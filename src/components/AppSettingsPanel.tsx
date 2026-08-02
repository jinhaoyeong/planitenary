import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, ImagePlus, Link2, PawPrint, Plus, Trash2, Upload } from 'lucide-react';
import {
  createPetId,
  DEFAULT_PETS,
  downloadPetPack,
  loadPetPack,
  parsePetPackImport,
  readImageAsDataUrl,
  savePetPack,
  subscribePetPack,
  type PetDefinition,
} from '../lib/petPack';

interface AppSettingsPanelProps {
  showPets: boolean;
  onTogglePets: () => void;
}

export function AppSettingsPanel({ showPets, onTogglePets }: AppSettingsPanelProps) {
  const [pets, setPets] = useState<PetDefinition[]>(() => loadPetPack());
  const [name, setName] = useState('');
  const [spriteUrl, setSpriteUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => subscribePetPack(() => setPets(loadPetPack())), []);

  const persist = (next: PetDefinition[]) => {
    setPets(next);
    savePetPack(next);
  };

  const updatePet = (id: string, patch: Partial<PetDefinition>) => {
    persist(pets.map((pet) => (pet.id === id ? { ...pet, ...patch } : pet)));
  };

  const removePet = (id: string) => {
    const pet = pets.find((item) => item.id === id);
    if (!pet) return;
    if (pet.source === 'builtin') {
      updatePet(id, { enabled: false });
      setStatus(`${pet.name} hidden. Built-in pets stay available to turn back on.`);
      return;
    }
    if (!window.confirm(`Remove “${pet.name}” from your pet pack?`)) return;
    persist(pets.filter((item) => item.id !== id));
    setStatus(`Removed ${pet.name}.`);
  };

  const addPetFromUrl = () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedSprite = spriteUrl.trim();
    if (!trimmedName) {
      setError('Give your pet a name.');
      return;
    }
    if (!trimmedSprite || !/^https?:\/\//i.test(trimmedSprite) && !trimmedSprite.startsWith('data:image/')) {
      setError('Add an image URL (https://...) or upload an image.');
      return;
    }
    const nextPet: PetDefinition = {
      id: createPetId(),
      name: trimmedName,
      sprite: trimmedSprite,
      speed: 1.6,
      enabled: true,
      source: 'custom',
    };
    persist([...pets, nextPet]);
    setName('');
    setSpriteUrl('');
    setStatus(`Added ${trimmedName}. Turn on Animated pets to see it.`);
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setSpriteUrl(dataUrl);
      if (!name.trim()) {
        setName(file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'My pet');
      }
      setStatus('Image ready. Add the pet to save it to your pack.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to read that image.');
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const imported = parsePetPackImport(text);
      if (!window.confirm(`Import ${imported.length} pet${imported.length === 1 ? '' : 's'} into your pack?`)) return;
      const byId = new Map(pets.map((pet) => [pet.id, pet]));
      imported.forEach((pet) => byId.set(pet.id, pet));
      persist(Array.from(byId.values()));
      setStatus(`Imported ${imported.length} pets into your pack.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Unable to import that pet pack.');
    }
  };

  const handleExport = () => {
    downloadPetPack(pets);
    setStatus('Exported your pet pack as JSON.');
  };

  const resetBuiltins = () => {
    if (!window.confirm('Restore the default Cat, Dog, and Black Puppy pets? Custom pets stay.')) return;
    const customs = pets.filter((pet) => pet.source === 'custom');
    persist([...DEFAULT_PETS.map((pet) => ({ ...pet })), ...customs]);
    setStatus('Built-in pets restored.');
  };

  return (
    <section className="w-full space-y-6">
      <div className="editorial-card p-4 sm:p-5 md:p-8">
        <div className="eyebrow">Settings</div>
        <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[0.95]" style={{ color: 'var(--ink)' }}>
          App preferences.
        </h2>
        <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
          Control optional extras for your handbook. Pet packs stay on this device and can be exported anytime.
        </p>
      </div>

      <div className="editorial-card p-4 sm:p-5 md:p-8 space-y-5">
        <div
          className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div className="min-w-0 flex items-start gap-3">
            <div
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <PawPrint className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Animated pets</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Show your enabled pets floating over the handbook. Off by default for a cleaner view.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showPets}
            aria-label="Show animated pets"
            className="editorial-toggle shrink-0 self-start sm:self-center"
            data-checked={showPets ? 'true' : 'false'}
            onClick={onTogglePets}
          >
            <span className="editorial-toggle-thumb" />
          </button>
        </div>

        {(status || error) && (
          <div
            className="rounded-2xl px-4 py-3 text-sm"
            style={{
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border)',
              color: error ? 'var(--warn)' : 'var(--ink)',
            }}
            role={error ? 'alert' : 'status'}
          >
            {error || status}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="pill-btn pill-soft justify-center" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export pets
          </button>
          <button
            type="button"
            className="pill-btn pill-soft justify-center"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            Import pets
          </button>
          <button type="button" className="pill-btn pill-ghost justify-center" onClick={resetBuiltins}>
            Restore defaults
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImport(event)}
          />
        </div>

        <div className="space-y-3">
          <div className="eyebrow">Your pet pack</div>
          {pets.map((pet) => (
            <div
              key={pet.id}
              className="rounded-2xl p-3 sm:p-4 flex items-center gap-3"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <img
                src={pet.sprite}
                alt={pet.name}
                className="w-12 h-12 object-contain shrink-0"
                style={{ imageRendering: 'pixelated' }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>{pet.name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {pet.source === 'builtin' ? 'Built-in' : 'Custom'} · {pet.enabled ? 'Enabled' : 'Hidden'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pet.enabled}
                aria-label={`${pet.enabled ? 'Hide' : 'Show'} ${pet.name}`}
                className="editorial-toggle shrink-0"
                data-checked={pet.enabled ? 'true' : 'false'}
                onClick={() => updatePet(pet.id, { enabled: !pet.enabled })}
              >
                <span className="editorial-toggle-thumb" />
              </button>
              <button
                type="button"
                className="p-2 rounded-full shrink-0"
                style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                aria-label={`Remove ${pet.name}`}
                onClick={() => removePet(pet.id)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
          <div>
            <div className="eyebrow">Add a pet</div>
            <h3 className="font-display text-2xl mt-3" style={{ color: 'var(--ink)' }}>Import your own companion.</h3>
            <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>
              Use an image URL or upload a small sprite/GIF/PNG, then save it to your pack.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="editorial-input w-full"
                placeholder="Mochi"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Image URL</span>
              <div className="relative">
                <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }} />
                <input
                  value={spriteUrl.startsWith('data:image/') ? '' : spriteUrl}
                  onChange={(event) => setSpriteUrl(event.target.value)}
                  className="editorial-input w-full !pl-9"
                  placeholder="https://..."
                />
              </div>
            </label>
          </div>

          {spriteUrl.startsWith('data:image/') && (
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
              <img src={spriteUrl} alt="Pet preview" className="w-12 h-12 object-contain" style={{ imageRendering: 'pixelated' }} />
              Uploaded image ready to save.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pill-btn pill-soft justify-center"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="w-4 h-4" />
              Upload image
            </button>
            <button type="button" className="pill-btn pill-primary justify-center" onClick={addPetFromUrl}>
              <Plus className="w-4 h-4" />
              Add to pack
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void handleImageUpload(event)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
