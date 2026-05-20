// hooks/useLocalSorting.ts
import { useState, useMemo, useCallback } from 'react';
import { LocalTrack } from '@/db/localDatabase';

export type SortKey =
  | "name"
  | "artist"
  | "album"
  | "filename"
  | "folder"
  | "year"
  | "duration"
  | "trackNumber"
  | "rating"
  | "playCount"
  | "dateAdded"
  | "dateModified";

export type SortDir = "asc" | "desc";

export interface SortEntry {
  key: SortKey;
  dir: SortDir;
}

export const SORT_META: Record<SortKey, { label: string; icon: string }> = {
  name:         { label: "Name",        icon: "text-outline"           },
  artist:       { label: "Artist",      icon: "person-outline"         },
  album:        { label: "Album",       icon: "disc-outline"           },
  filename:     { label: "Filename",    icon: "document-text-outline"  },
  folder:       { label: "Folder",      icon: "folder-outline"         },
  year:         { label: "Year",        icon: "calendar-outline"       },
  duration:     { label: "Duration",    icon: "timer-outline"          },
  trackNumber:  { label: "Track #",     icon: "list-outline"           },
  rating:       { label: "Rating",      icon: "star-outline"           },
  playCount:    { label: "Plays",       icon: "bar-chart-outline"      },
  dateAdded:    { label: "Added",       icon: "add-circle-outline"     },
  dateModified: { label: "Modified",    icon: "pencil-outline"         },
};

export const SORT_KEYS = Object.keys(SORT_META) as SortKey[];

export function applySorts<T extends Record<string, any>>(items: T[], sorts: SortEntry[]): T[] {
  if (!sorts.length) return [...items];
  
  return [...items].sort((a, b) => {
    for (const { key, dir } of sorts) {
      let va: any, vb: any;
      switch (key) {
        case "name":         va = a.title   ?? a.name   ?? ""; vb = b.title   ?? b.name   ?? ""; break;
        case "artist":       va = a.artist  ?? "";             vb = b.artist  ?? "";             break;
        case "album":        va = a.album   ?? "";             vb = b.album   ?? "";             break;
        case "filename":     va = a.file_uri ?? a.filename ?? ""; vb = b.file_uri ?? b.filename ?? ""; break;
        case "folder":       va = a.folder  ?? a.album_id ?? ""; vb = b.folder  ?? b.album_id ?? ""; break;
        case "year":         va = Number(a.year ?? 0);         vb = Number(b.year ?? 0);         break;
        case "duration":     va = Number(a.duration ?? 0);     vb = Number(b.duration ?? 0);     break;
        case "trackNumber":  va = Number(a.track_number ?? 0); vb = Number(b.track_number ?? 0); break;
        case "rating":       va = Number(a.rating ?? 0);       vb = Number(b.rating ?? 0);       break;
        case "playCount":    va = Number(a.play_count ?? 0);   vb = Number(b.play_count ?? 0);   break;
        case "dateAdded":    va = a.added_to_library ?? a.date_added ?? ""; vb = b.added_to_library ?? b.date_added ?? ""; break;
        case "dateModified": va = a.last_modified ?? a.date_modified ?? ""; vb = b.last_modified ?? b.date_modified ?? ""; break;
        default:             va = ""; vb = "";
      }
      
      let cmp: number;
      if (typeof va === "string") {
        cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: "base" });
      } else {
        cmp = va - vb;
      }
      
      if (dir === "desc") cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

export interface UseLocalSortingReturn {
  sorts: SortEntry[];
  limit: number;
  sortPanelVisible: boolean;
  setSortPanelVisible: (visible: boolean) => void;
  addSort: (key: SortKey) => void;
  removeSort: (key: SortKey) => void;
  toggleSortDir: (key: SortKey) => void;
  setLimit: (limit: number) => void;
  clearAllSorts: () => void;
  clearSorts: () => void;  // Alias for clearAllSorts
  activeSortCount: number;
  getSortedAndLimited: <T extends Record<string, any>>(items: T[]) => T[];
  getSortLabel: (key: SortKey) => string;
  getSortIcon: (key: SortKey) => string;
  isSortedBy: (key: SortKey) => boolean;
  setSorts: (sorts: SortEntry[]) => void;  // For restoring saved sorts
}

export function useLocalSorting(): UseLocalSortingReturn {
  const [sorts, setSorts] = useState<SortEntry[]>([]);
  const [limit, setLimit] = useState<number>(0);
  const [sortPanelVisible, setSortPanelVisible] = useState<boolean>(false);

  const addSort = useCallback((key: SortKey) => {
    setSorts((prev) => {
      if (prev.some((s) => s.key === key)) return prev;
      return [...prev, { key, dir: "asc" }];
    });
  }, []);

  const removeSort = useCallback((key: SortKey) => {
    setSorts((prev) => prev.filter((s) => s.key !== key));
  }, []);

  const toggleSortDir = useCallback((key: SortKey) => {
    setSorts((prev) =>
      prev.map((s) => (s.key === key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : s))
    );
  }, []);

  const clearAllSorts = useCallback(() => {
    setSorts([]);
  }, []);

  const clearSorts = useCallback(() => {
    setSorts([]);
  }, []);

  const getSortedAndLimited = useCallback(
    <T extends Record<string, any>>(items: T[]): T[] => {
      let result = applySorts(items, sorts);
      if (limit > 0) result = result.slice(0, limit);
      return result;
    },
    [sorts, limit]
  );

  const getSortLabel = useCallback((key: SortKey) => SORT_META[key].label, []);
  const getSortIcon = useCallback((key: SortKey) => SORT_META[key].icon, []);
  const isSortedBy = useCallback((key: SortKey) => sorts.some((s) => s.key === key), [sorts]);

  const activeSortCount = sorts.length;

  return {
    sorts,
    limit,
    sortPanelVisible,
    setSortPanelVisible,
    addSort,
    removeSort,
    toggleSortDir,
    setLimit,
    clearAllSorts,
    clearSorts,
    activeSortCount,
    getSortedAndLimited,
    getSortLabel,
    getSortIcon,
    isSortedBy,
    setSorts,
  };
}