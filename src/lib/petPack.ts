import { safeGetItem, safeSetItem } from './safeLocalStorage';

export type PetDefinition = {
  id: string;
  name: string;
  sprite: string;
  speed?: number;
  spriteFilter?: string;
  enabled: boolean;
  source: 'builtin' | 'custom';
};

type PetPackFile = {
  kind: 'travel-handbook-pets-v1';
  exportedAt: string;
  pets: PetDefinition[];
};

const STORAGE_KEY = 'travel-handbook-pets-v1';
const CHANGE_EVENT = 'pets-pack-changed';

export const DEFAULT_PETS: PetDefinition[] = [
  {
    id: 'builtin-cat',
    name: 'Cat',
    sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/431.gif',
    speed: 1.5,
    spriteFilter: 'contrast-125 saturate-100 grayscale-[0.2]',
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'builtin-dog',
    name: 'Dog',
    sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/133.gif',
    speed: 2,
    spriteFilter: 'contrast-125 saturate-[1.1] hue-rotate-[-10deg]',
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'builtin-black-puppy',
    name: 'Black Puppy',
    sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/197.gif',
    speed: 1.8,
    spriteFilter: 'contrast-125 saturate-110',
    enabled: true,
    source: 'builtin',
  },
];

const isPetDefinition = (value: unknown): value is PetDefinition => {
  if (!value || typeof value !== 'object') return false;
  const pet = value as Partial<PetDefinition>;
  return (
    typeof pet.id === 'string'
    && pet.id.trim().length > 0
    && typeof pet.name === 'string'
    && pet.name.trim().length > 0
    && typeof pet.sprite === 'string'
    && pet.sprite.trim().length > 0
    && typeof pet.enabled === 'boolean'
    && (pet.source === 'builtin' || pet.source === 'custom')
  );
};

const normalizePet = (pet: PetDefinition): PetDefinition => ({
  id: pet.id.trim(),
  name: pet.name.trim().slice(0, 40),
  sprite: pet.sprite.trim(),
  speed: typeof pet.speed === 'number' && Number.isFinite(pet.speed)
    ? Math.max(0.4, Math.min(4, pet.speed))
    : 1.6,
  spriteFilter: typeof pet.spriteFilter === 'string' && pet.spriteFilter.trim()
    ? pet.spriteFilter.trim()
    : 'contrast-125 saturate-125',
  enabled: Boolean(pet.enabled),
  source: pet.source === 'builtin' ? 'builtin' : 'custom',
});

const notifyPetPackChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

export function loadPetPack(): PetDefinition[] {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PETS.map((pet) => ({ ...pet }));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_PETS.map((pet) => ({ ...pet }));
    const pets = parsed.filter(isPetDefinition).map(normalizePet);
    return pets.length > 0 ? pets : DEFAULT_PETS.map((pet) => ({ ...pet }));
  } catch {
    return DEFAULT_PETS.map((pet) => ({ ...pet }));
  }
}

export function savePetPack(pets: PetDefinition[]) {
  const normalized = pets.map(normalizePet);
  safeSetItem(STORAGE_KEY, JSON.stringify(normalized));
  notifyPetPackChanged();
}

export function createPetId() {
  return `custom-${crypto.randomUUID()}`;
}

export function exportPetPack(pets: PetDefinition[]): PetPackFile {
  return {
    kind: 'travel-handbook-pets-v1',
    exportedAt: new Date().toISOString(),
    pets: pets.map(normalizePet),
  };
}

export function parsePetPackImport(raw: string): PetDefinition[] {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed
      && typeof parsed === 'object'
      && Array.isArray((parsed as PetPackFile).pets)
      ? (parsed as PetPackFile).pets
      : null;

  if (!list) {
    throw new Error('This file does not look like a Travel Handbook pet pack.');
  }

  const pets = list.filter(isPetDefinition).map((pet) => normalizePet({
    ...pet,
    source: 'custom',
    id: pet.id.startsWith('custom-') ? pet.id : createPetId(),
  }));

  if (pets.length === 0) {
    throw new Error('No valid pets were found in that file.');
  }

  return pets;
}

export function downloadPetPack(pets: PetDefinition[], filename = 'travel-handbook-pets.json') {
  const payload = exportPetPack(pets);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function subscribePetPack(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    if (file.size > 1_500_000) {
      reject(new Error('Keep pet images under 1.5 MB so they can be saved on this device.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unable to read that image.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read that image.'));
    reader.readAsDataURL(file);
  });
}
