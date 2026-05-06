import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Save, Trash2, UserRound } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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

export function ProfilePanel() {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const [profile, setProfile] = useState<UserProfileData>(DEFAULT_PROFILE);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
  const accountType = isDemoUser ? 'Demo account' : isLocalTestUser ? 'Local test account' : 'Cloud account';

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

  return (
    <section className="w-full">
      <div className="editorial-card p-6 md:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Profile</div>
            <h2 className="font-display text-4xl md:text-5xl mt-4" style={{ color: 'var(--ink)' }}>
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

        <div className="mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>
          <UserRound className="w-3.5 h-3.5" />
          {accountType}
        </div>

        {status && (
          <div className="mt-5 rounded-2xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
            {status}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-6 mt-8">
          <div className="space-y-4">
            <div className="editorial-card p-5">
              <div className="eyebrow">Photo</div>
              <h3 className="font-display text-3xl mt-3">Profile image</h3>

              <div
                className="mt-5 rounded-[2rem] overflow-hidden aspect-square flex items-center justify-center text-center"
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
                <label className="pill-btn pill-primary cursor-pointer">
                  <ImagePlus className="w-4 h-4" />
                  Upload image
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
                <button type="button" className="pill-btn pill-soft" onClick={() => updateField('avatarImage', null)}>
                  <Trash2 className="w-4 h-4" />
                  Remove image
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
    </section>
  );
}
