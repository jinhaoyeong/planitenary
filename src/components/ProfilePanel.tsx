import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, LogOut, Save, Trash2, UserRound, Edit3 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { SecurityPanel } from './SecurityPanel';

interface UserProfileData {
  displayName: string;
  fullName: string;
  location: string;
  bio: string;
  avatarImage: string | null;
}

const DEFAULT_PROFILE: UserProfileData = {
  displayName: '',
  fullName: '',
  location: '',
  bio: '',
  avatarImage: null,
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function ProfilePanel({ onEditHomeHero }: { onEditHomeHero?: () => void }) {
  const { user, isDemoUser, isLocalTestUser, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfileData>(DEFAULT_PROFILE);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (!user) return;

    const profileKey = `profile-${user.id}`;
    const metadata = (user.user_metadata || {}) as Record<string, unknown>;
    const savedRaw = localStorage.getItem(profileKey);

    let savedProfile: Partial<UserProfileData> = {};
    if (savedRaw) {
      try {
        savedProfile = JSON.parse(savedRaw) as Partial<UserProfileData>;
      } catch {
        savedProfile = {};
      }
    }

    setProfile({
      displayName: (savedProfile.displayName as string) || (metadata.displayName as string) || (metadata.display_name as string) || '',
      fullName: (savedProfile.fullName as string) || (metadata.fullName as string) || (metadata.full_name as string) || '',
      location: (savedProfile.location as string) || (metadata.location as string) || '',
      bio: (savedProfile.bio as string) || (metadata.bio as string) || '',
      avatarImage: (savedProfile.avatarImage as string | null) || null,
    });
    setStatus(null);
  }, [user]);

  if (!user) {
    return null;
  }

  const profileKey = `profile-${user.id}`;

  const updateField = (field: keyof UserProfileData, value: string | null) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateField('avatarImage', dataUrl);
      setStatus(null);
    } catch (error) {
      console.error('Failed to load profile image', error);
      window.alert('Unable to read that image. Please try another file.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);

    const nextProfile: UserProfileData = {
      displayName: profile.displayName.trim(),
      fullName: profile.fullName.trim(),
      location: profile.location.trim(),
      bio: profile.bio.trim(),
      avatarImage: profile.avatarImage,
    };

    localStorage.setItem(profileKey, JSON.stringify(nextProfile));

    if (!isDemoUser && !isLocalTestUser && isSupabaseConfigured()) {
      const { error } = await supabase.auth.updateUser({
        data: {
          displayName: nextProfile.displayName,
          fullName: nextProfile.fullName,
          location: nextProfile.location,
          bio: nextProfile.bio,
        },
      });

      if (error) {
        setStatus('Saved locally, but cloud profile sync failed.');
        setIsSaving(false);
        return;
      }
    }

    setStatus('Profile saved.');
    setIsSaving(false);
  };

  const handleSignOut = async () => {
    const label = isDemoUser ? 'Exit demo mode and return to the sign-in screen?' : 'Sign out of Travel Handbook?';
    if (!window.confirm(label)) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <section className="w-full space-y-6">
      <div className="editorial-card p-4 sm:p-5 md:p-8">
        {onEditHomeHero && (
          <div className="mb-6 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Home hero banner</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>Edit the banner copy, buttons, cover text, day badge, and marquee directly on the home view.</p>
            </div>
            <button type="button" onClick={onEditHomeHero} className="pill-btn pill-primary shrink-0 justify-center"><Edit3 className="w-4 h-4" /> Edit home hero</button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Profile</div>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[0.95]" style={{ color: 'var(--ink)' }}>
              Edit your personal details.
            </h2>
            <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
              Update the information attached to your account. Your email stays read-only here, but your profile details can be changed anytime.
            </p>
          </div>

          <button onClick={handleSave} className="pill-btn pill-primary w-full sm:w-auto justify-center" disabled={isSaving}>
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save profile'}
          </button>
        </div>

        {status && (
          <div className="mt-5 rounded-2xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
            {status}
          </div>
        )}

        <div className="flex flex-col xl:flex-row gap-6 md:gap-10 mt-6 md:mt-8">
          <div className="xl:w-1/3 shrink-0">
            <div className="editorial-card p-4 md:p-5">
              <div className="eyebrow">Photo</div>
              <h3 className="font-display text-2xl sm:text-3xl mt-3">Profile image</h3>

              <div
                className="mt-5 rounded-[2rem] overflow-hidden aspect-square min-h-48 flex items-center justify-center text-center"
                style={{ backgroundColor: 'var(--bg)', border: '1px dashed var(--border)' }}
              >
                {profile.avatarImage ? (
                  <img src={profile.avatarImage} alt="Profile preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="px-6">
                    <UserRound className="w-10 h-10 mx-auto" style={{ color: 'var(--accent)' }} />
                    <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
                      Upload a photo for your profile card.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3 mt-5">
                <label className="pill-btn pill-primary cursor-pointer w-full justify-center">
                  <ImagePlus className="w-4 h-4" />
                  Upload image
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
                <button type="button" className="pill-btn pill-soft w-full justify-center" onClick={() => updateField('avatarImage', null)}>
                  <Trash2 className="w-4 h-4" />
                  Remove image
                </button>
              </div>
            </div>
          </div>

          <div className="xl:w-2/3 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Display Name
                </label>
                <input
                  value={profile.displayName}
                  onChange={(event) => updateField('displayName', event.target.value)}
                  className="editorial-input w-full"
                  placeholder="Alex"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Full Name
                </label>
                <input
                  value={profile.fullName}
                  onChange={(event) => updateField('fullName', event.target.value)}
                  className="editorial-input w-full"
                  placeholder="Alex Morgan"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Email Address
              </label>
              <input
                value={user.email || ''}
                disabled
                className="editorial-input w-full opacity-75"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Location
              </label>
              <input
                value={profile.location}
                onChange={(event) => updateField('location', event.target.value)}
                className="editorial-input w-full"
                placeholder="London, UK"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Bio
              </label>
              <textarea
                value={profile.bio}
                onChange={(event) => updateField('bio', event.target.value)}
                className="editorial-textarea w-full"
                style={{ minHeight: '9rem' }}
                placeholder="Tell us a little about your travel style, interests, or planning habits."
              />
            </div>
          </div>
        </div>
      </div>

      <SecurityPanel />

      <div className="editorial-card p-4 sm:p-5 md:p-8">
        <div className="eyebrow">Account</div>
        <h2 className="font-display text-3xl sm:text-4xl mt-4 leading-[0.95]" style={{ color: 'var(--ink)' }}>
          {isDemoUser ? 'Exit demo mode.' : 'Sign out.'}
        </h2>
        <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
          {isDemoUser
            ? 'Leave demo mode and return to the welcome screen. Demo trip data stays on this device.'
            : 'Sign out of this device. Your trip data stays saved to your account.'}
        </p>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={isSigningOut}
          className="pill-btn mt-6 w-full sm:w-auto justify-center"
          style={{
            color: 'var(--accent)',
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          }}
        >
          <LogOut className="w-4 h-4" />
          {isSigningOut ? 'Signing out...' : isDemoUser ? 'Exit demo' : 'Sign out'}
        </button>
      </div>
    </section>
  );
}
