import { defaultLoadoutParameters } from '@destinyitemmanager/dim-api-types';
import { t } from 'app/i18next-t';
import { D2BucketCategory } from 'app/inventory/inventory-buckets';
import { PluggableInventoryItemDefinition } from 'app/inventory/item-types';
import {
  allItemsSelector,
  bucketsSelector,
  createItemContextSelector,
  storesSelector,
  unlockedPlugSetItemsSelector,
} from 'app/inventory/selectors';
import { getLockedExotic } from 'app/loadout-builder/filter/ExoticArmorChoice';
import { inGameArmorEnergyRules } from 'app/loadout-builder/types';
import { ResolvedLoadoutItem } from 'app/loadout-drawer/loadout-types';
import { getLoadoutStats, pickBackingStore } from 'app/loadout-drawer/loadout-utils';
import { loadoutsSelector } from 'app/loadout-drawer/loadouts-selector';
import { d2ManifestSelector } from 'app/manifest/selectors';
import { ThunkResult } from 'app/store/types';
import { filterMap } from 'app/utils/collections';
import { compareBy } from 'app/utils/comparators';
import { CsvRow, downloadCsv } from 'app/utils/csv';
import {
  aspectSocketCategoryHashes,
  fragmentSocketCategoryHashes,
  subclassAbilitySocketCategoryHashes,
} from 'app/utils/socket-utils';
import { DestinyClass } from 'bungie-api-ts/destiny2';
import { BucketHashes } from 'data/d2/generated-enums';
import { fullyResolveLoadout } from './ingame/selectors';
import { getSubclassPlugs } from './item-utils';

export function downloadLoadoutsCsv(): ThunkResult {
  return async (_dispatch, getState) => {
    const defs = d2ManifestSelector(getState());
    const stores = storesSelector(getState());
    const itemCreationContext = createItemContextSelector(getState());
    const allItems = allItemsSelector(getState());
    const allLoadouts = loadoutsSelector(getState());
    const buckets = bucketsSelector(getState());

    // perhaps we're loading
    if (!stores.length || !defs || !buckets) {
      return;
    }

    const data = filterMap(allLoadouts, (loadout) => {
      const storeId = pickBackingStore(stores, undefined, loadout.classType)?.id;
      if (!storeId) {
        return undefined;
      }
      const unlockedPlugs = unlockedPlugSetItemsSelector(storeId)(getState());
      const resolvedLoadout = fullyResolveLoadout(
        storeId,
        loadout,
        defs,
        unlockedPlugs,
        itemCreationContext,
        allItems,
      );
      const includesFontStats =
        loadout.parameters?.includeRuntimeStatBenefits ??
        defaultLoadoutParameters.includeRuntimeStatBenefits!;
      const subclass = resolvedLoadout.resolvedLoadoutItems.find(
        (item) => item.item.bucket.hash === BucketHashes.Subclass,
      );
      const subclassPlugs = getSubclassPlugs(defs, subclass);
      const abilities = subclassPlugs.filter((p) =>
        subclassAbilitySocketCategoryHashes.includes(p.socketCategoryHash),
      );
      const aspects = subclassPlugs.filter((p) =>
        aspectSocketCategoryHashes.includes(p.socketCategoryHash),
      );
      const fragments = subclassPlugs.filter((p) =>
        fragmentSocketCategoryHashes.includes(p.socketCategoryHash),
      );
      const stats: CsvRow = {};
      const equippedArmor = resolvedLoadout.resolvedLoadoutItems.filter(
        (i) => i.loadoutItem.equip && i.item.bucket.inArmor,
      );
      if (equippedArmor.length === 5) {
        const calculatedStats = getLoadoutStats(
          defs,
          loadout.classType,
          subclass,
          equippedArmor.map((i) => i.item),
          resolvedLoadout.resolvedMods.map((mod) => mod.resolvedMod),
          includesFontStats,
          inGameArmorEnergyRules,
        );
        for (const [statHash_, val] of Object.entries(calculatedStats)) {
          const def = defs.Stat.get(parseInt(statHash_, 10));
          if (def) {
            stats[def.displayProperties.name] = val.value;
          }
        }
      }

      const className =
        loadout.classType === DestinyClass.Unknown
          ? t('Loadouts.Any')
          : Object.values(defs.Class.getAll()).find((c) => c.classType === loadout.classType)!
              .displayProperties.name;

      const localizeResolvedPlugs = (list: { plug: PluggableInventoryItemDefinition }[]) =>
        list.map((mod) => mod.plug.displayProperties.name);

      const sortItems = (category: D2BucketCategory) =>
        compareBy((item: ResolvedLoadoutItem) =>
          buckets.byCategory[category].findIndex((b) => b.hash === item.item.bucket.hash),
        );

      const equippedItems = resolvedLoadout.resolvedLoadoutItems
        .filter((i) => i.loadoutItem.equip && i.item.bucket.hash !== BucketHashes.Subclass)
        .sort(sortItems('Weapons'));
      const unequippedItems = resolvedLoadout.resolvedLoadoutItems
        .filter((i) => !i.loadoutItem.equip)
        .sort(sortItems('Armor'));

      return {
        Id: loadout.id,
        'Class Type': className,
        Name: loadout.name,
        Notes: loadout.notes,
        'Last Edited': loadout.lastUpdatedAt
          ? new Date(loadout.lastUpdatedAt).toDateString()
          : undefined,
        ...stats,
        Subclass: subclass?.item.name,
        Abilities: localizeResolvedPlugs(abilities),
        Aspects: localizeResolvedPlugs(aspects),
        Fragments: localizeResolvedPlugs(fragments),
        'Equipped Items': equippedItems.map((i) => i.item.name),
        'Unequipped Items': unequippedItems.map((i) => i.item.name),
        Mods: resolvedLoadout.resolvedMods.map((mod) => mod.resolvedMod.displayProperties.name),
        'Artifact Season': loadout.parameters?.artifactUnlocks?.seasonNumber,
        'Artifact Unlocks': loadout.parameters?.artifactUnlocks?.unlockedItemHashes.map(
          (modHash) => defs.InventoryItem.get(modHash)?.displayProperties.name,
        ),
        'Exotic Armor':
          loadout.parameters?.exoticArmorHash !== undefined
            ? getLockedExotic(defs, loadout.parameters?.exoticArmorHash)?.[1]
            : undefined,
      };
    });

    downloadCsv(`destinyLoadouts`, data, {
      unpackArrays: [
        'Abilities',
        'Aspects',
        'Fragments',
        'Equipped Items',
        'Unequipped Items',
        'Mods',
        'Artifact Unlocks',
      ],
    });
  };
}
