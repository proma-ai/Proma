import type { NotificationSoundId, NotificationSoundPackId } from '@/types/settings'

export const NOTIFICATION_SOUND_PACK_IDS: NotificationSoundPackId[] = [
  'minimal',
  'soft',
  'glass',
  'arcade',
  'mechanical',
  'organic',
  'dreamy',
  'scifi',
  'rubber',
  'cinematic',
  'studio',
  'zen',
]

const LEGACY_SOUND_PACKS: Record<string, NotificationSoundPackId> = {
  ding: 'minimal',
  'ding-dong': 'soft',
  discord: 'arcade',
  done: 'studio',
  'down-power': 'mechanical',
  food: 'organic',
  lite: 'glass',
  quiet: 'zen',
}

export function getEffectiveSoundPackId(soundId: NotificationSoundId | undefined): NotificationSoundPackId {
  if (soundId && NOTIFICATION_SOUND_PACK_IDS.includes(soundId as NotificationSoundPackId)) {
    return soundId as NotificationSoundPackId
  }
  return (soundId && LEGACY_SOUND_PACKS[soundId]) ?? 'minimal'
}
