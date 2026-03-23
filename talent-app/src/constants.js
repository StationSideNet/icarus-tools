/**
 * Application-wide constants.
 */

import { resolveAppUrl } from './utils.js'

export const VERSIONS_URL = resolveAppUrl('Data/versions.json')
export const getDataUrl = (versionId) => resolveAppUrl(`Data/${versionId}/talents.json`)
export const getBlueprintDataUrl = (versionId) => resolveAppUrl(`Data/${versionId}/blueprints.json`)
export const getLocaleBaseUrl = (versionId) => resolveAppUrl(`Data/${versionId}/Localization/Game`)
export const getLocaleConfigUrl = (versionId) => `${getLocaleBaseUrl(versionId)}/Game.json`
export const ASSET_BASE_URL = resolveAppUrl('Assets/Icarus/Content')
export const MODIFIER_LABELS_URL = resolveAppUrl('UI/Localization/en.json')
export const DEFAULT_LOCALE = 'en'
export const LOCALE_COOKIE_NAME = 'talent_locale'
export const SAVED_BUILDS_STORAGE_KEY = 'talent_saved_builds_v1'
export const ACTIVE_BUILD_STORAGE_KEY = 'talent_active_builds_v2'
export const SHARE_BUILD_QUERY_KEY = 'build'
export const SHARE_BUILD_CODEC_VERSION = 2
export const SAVED_BUILD_ACTION_FEEDBACK_MS = 1800
export const SAVED_BUILD_DELETE_ANIMATION_MS = 1950
export const ENABLED_MODELS = ['Player', 'Creature']
export const BLUEPRINT_MODEL_ID = 'Blueprint'
export const RANK_INVESTMENTS = {
  Novice: 0,
  Apprentice: 4,
  Journeyman: 8,
  Master: 12
}
export const MAX_TALENT_POINTS = 90
export const MAX_SOLO_POINTS = 30
export const CREATURE_MOUNT_LEVEL_CAP = 50
export const CREATURE_PET_LEVEL_CAP = 25
export const CREATURE_BASE_ARCHETYPE_ID = 'Creature_Base'
export const HIDDEN_CREATURE_ARCHETYPE_IDS = new Set([CREATURE_BASE_ARCHETYPE_ID])
export const CREATURE_TAB_GROUPS = [
  {
    id: 'mount',
    label: 'Mounts',
    icon: '/Game/Assets/2DArt/UI/Icons/Icon_Speed.Icon_Speed'
  },
  {
    id: 'combatPet',
    label: 'Tames',
    icon: '/Game/Assets/2DArt/UI/Icons/Icon_AggressiveCreature.Icon_AggressiveCreature'
  },
  {
    id: 'regularPet',
    label: 'Livestock',
    icon: '/Game/Assets/2DArt/UI/Icons/T_Icon_Homestead.T_Icon_Homestead'
  }
]
export const GITHUB_REPO_URL = 'https://github.com/StationSideNet/icarus-tools'
export const ROCKETWERKZ_URL = 'https://rocketwerkz.com/'
export const ICARUS_STEAM_URL = 'https://store.steampowered.com/sale/icarus'
export const TOP_MENU_ICON_UNREAL_PATHS = {
  Player: '/Game/Assets/2DArt/UI/Icons/Icon_Solo.Icon_Solo',
  Creature: '/Game/Assets/2DArt/UI/Icons/T_ICON_Paws.T_ICON_Paws',
  TechTree: '/Game/Assets/2DArt/UI/Icons/T_Icon_TechTree.T_Icon_TechTree',
  Workshop: '/Game/Assets/2DArt/UI/Icons/Icon_RenCurrency.Icon_RenCurrency'
}
