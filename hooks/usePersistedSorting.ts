// hooks/usePersistedSorting.ts
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSorting, type SortEntry, type SortKey } from './useLocalSorting';

const SORT_STORAGE_KEY = 'folder_sort_preferences';

export function usePersistedSorting(folderId: string) {
  const {
    sorts,
    sortPanelVisible,
    setSortPanelVisible,
    addSort,
    removeSort,
    toggleSortDir,
    clearSorts,
    activeSortCount,
  } = useLocalSorting();

  // Load saved sorts when folder changes
  useEffect(() => {
    const loadSavedSorts = async () => {
      try {
        const saved = await AsyncStorage.getItem(`${SORT_STORAGE_KEY}_${folderId}`);
        if (saved) {
          const parsed = JSON.parse(saved) as SortEntry[];
          if (parsed.length > 0) {
            // Clear existing sorts and add saved ones
            clearSorts();
            for (const sort of parsed) {
              addSort(sort.key);
              if (sort.dir === 'desc') {
                toggleSortDir(sort.key);
              }
            }
          }
        }
      } catch (error) {
        console.warn('[PersistedSorting] Failed to load:', error);
      }
    };

    loadSavedSorts();
  }, [folderId]);

  // Save sorts when they change
  useEffect(() => {
    const saveSorts = async () => {
      try {
        if (sorts.length > 0) {
          await AsyncStorage.setItem(
            `${SORT_STORAGE_KEY}_${folderId}`,
            JSON.stringify(sorts)
          );
        } else {
          await AsyncStorage.removeItem(`${SORT_STORAGE_KEY}_${folderId}`);
        }
      } catch (error) {
        console.warn('[PersistedSorting] Failed to save:', error);
      }
    };

    saveSorts();
  }, [sorts, folderId]);

  return {
    sorts,
    sortPanelVisible,
    setSortPanelVisible,
    addSort,
    removeSort,
    toggleSortDir,
    clearSorts,
    activeSortCount,
  };
}