import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { Itinerary } from '../data';

export interface TripAppSettings {
  heroEyebrow: string;
  heroHeadline: string;
  coverLabel: string;
  marqueeItems: string[];
  coverImage: string | null;
  immersiveEffects: boolean;
}

interface SettingsPanelProps {
  itinerary: Itinerary;
  settings: TripAppSettings;
  onSave: (itinerary: Itinerary, settings: TripAppSettings) => void;
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function SettingsPanel({ itinerary, settings, onSave }: SettingsPanelProps) {
  const [title, setTitle] = useState(itinerary.name);
  const [description, setDescription] = useState(itinerary.description);
  const [cities, setCities] = useState(itinerary.cities.join(', '));
  const [heroEyebrow, setHeroEyebrow] = useState(settings.heroEyebrow);
  const [heroHeadline, setHeroHeadline] = useState(settings.heroHeadline);
  const [coverLabel, setCoverLabel] = useState(settings.coverLabel);
  const [marqueeItems, setMarqueeItems] = useState(settings.marqueeItems.join(', '));
  const [coverImage, setCoverImage] = useState<string | null>(settings.coverImage);
  const [immersiveEffects, setImmersiveEffects] = useState(settings.immersiveEffects);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTitle(itinerary.name);
    setDescription(itinerary.description);
    setCities(itinerary.cities.join(', '));
  }, [itinerary]);

  useEffect(() => {
    setHeroEyebrow(settings.heroEyebrow);
    setHeroHeadline(settings.heroHeadline);
    setCoverLabel(settings.coverLabel);
    setMarqueeItems(settings.marqueeItems.join(', '));
    setCoverImage(settings.coverImage);
    setImmersiveEffects(settings.immersiveEffects);
  }, [settings]);

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCoverImage(dataUrl);
    } catch (error) {
      console.error('Failed to read cover image', error);
      window.alert('Unable to read that image. Please try another file.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSave = () => {
    setIsSaving(true);

    const nextItinerary: Itinerary = {
      ...itinerary,
      name: title.trim() || 'New Trip',
      description: description.trim() || 'Start planning your travel handbook from scratch.',
      cities: cities
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };

    const nextSettings: TripAppSettings = {
      heroEyebrow: heroEyebrow.trim() || 'A personalized travel starter',
      heroHeadline: heroHeadline.trim() || 'Plan your next trip your way.',
      coverLabel: coverLabel.trim() || 'Custom cover',
      marqueeItems: marqueeItems
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      coverImage,
      immersiveEffects,
    };

    onSave(nextItinerary, nextSettings);
    window.setTimeout(() => setIsSaving(false), 200);
  };

  const handleResetCover = () => {
    setCoverImage(null);
  };

  return (
    <section className="w-full">
      <div className="editorial-card p-6 md:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Global Settings</div>
            <h2 className="font-display text-4xl md:text-5xl mt-4" style={{ color: 'var(--ink)' }}>
              Make the handbook yours.
            </h2>
            <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
              Customize the trip title, cover image, hero text, marquee strip, and a few visual settings in one place.
            </p>
          </div>

          <button onClick={handleSave} className="pill-btn pill-primary w-full sm:w-auto justify-center">
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save settings'}
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5 md:gap-6 mt-8">
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Trip Title
                </label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="editorial-input w-full"
                  placeholder="Summer in Japan"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Cities
                </label>
                <input
                  value={cities}
                  onChange={(event) => setCities(event.target.value)}
                  className="editorial-input w-full"
                  placeholder="Tokyo, Kyoto, Osaka"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Trip Description
              </label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="editorial-textarea w-full"
                style={{ minHeight: '7rem' }}
                placeholder="Short summary shown in the hero and overview."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Hero Eyebrow
                </label>
                <input
                  value={heroEyebrow}
                  onChange={(event) => setHeroEyebrow(event.target.value)}
                  className="editorial-input w-full"
                  placeholder="A custom travel story"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Cover Label
                </label>
                <input
                  value={coverLabel}
                  onChange={(event) => setCoverLabel(event.target.value)}
                  className="editorial-input w-full"
                  placeholder="Trip cover"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Hero Headline
              </label>
              <textarea
                value={heroHeadline}
                onChange={(event) => setHeroHeadline(event.target.value)}
                className="editorial-textarea w-full"
                style={{ minHeight: '6rem' }}
                placeholder="Plan your next trip your way."
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Marquee Items
              </label>
              <input
                value={marqueeItems}
                onChange={(event) => setMarqueeItems(event.target.value)}
                className="editorial-input w-full"
                placeholder="Tokyo, Temples, Food, Maps, Notes"
              />
            </div>

            <label
              className="flex items-start gap-3 rounded-2xl p-4"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <input
                type="checkbox"
                checked={immersiveEffects}
                onChange={(event) => setImmersiveEffects(event.target.checked)}
                className="mt-1"
              />
              <div>
                <div className="font-semibold" style={{ color: 'var(--ink)' }}>Immersive visual effects</div>
                <div className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
                  Turn on grain and the custom cursor. Keep this off if you want the smoothest performance.
                </div>
              </div>
            </label>
          </div>

          <div className="space-y-4">
            <div className="editorial-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="eyebrow">Cover Image</div>
                  <h3 className="font-display text-3xl mt-3">Upload your own photo</h3>
                </div>
              </div>

              <div
                className="mt-5 rounded-[2rem] overflow-hidden min-h-56 sm:min-h-72 flex items-center justify-center text-center"
                style={{ backgroundColor: 'var(--bg)', border: '1px dashed var(--border)' }}
              >
                {coverImage ? (
                  <img src={coverImage} alt="Trip cover preview" className="w-full h-56 sm:h-72 object-cover" />
                ) : (
                  <div className="px-6">
                    <ImagePlus className="w-8 h-8 mx-auto" style={{ color: 'var(--accent)' }} />
                    <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
                      Upload a hero image to replace the placeholder cover.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3 mt-5">
                <label className="pill-btn pill-primary cursor-pointer">
                  <ImagePlus className="w-4 h-4" />
                  Upload image
                  <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                </label>

                <button onClick={handleResetCover} className="pill-btn pill-ghost" type="button">
                  <Trash2 className="w-4 h-4" />
                  Remove image
                </button>
              </div>
            </div>

            <div className="editorial-card p-5">
              <div className="eyebrow">Quick Reset</div>
              <h3 className="font-display text-3xl mt-3">Reset the form</h3>
              <button
                type="button"
                onClick={() => {
                  setTitle(itinerary.name);
                  setDescription(itinerary.description);
                  setCities(itinerary.cities.join(', '));
                  setHeroEyebrow(settings.heroEyebrow);
                  setHeroHeadline(settings.heroHeadline);
                  setCoverLabel(settings.coverLabel);
                  setMarqueeItems(settings.marqueeItems.join(', '));
                  setCoverImage(settings.coverImage);
                  setImmersiveEffects(settings.immersiveEffects);
                }}
                className="pill-btn pill-ghost mt-5"
              >
                <RotateCcw className="w-4 h-4" />
                Revert unsaved edits
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
