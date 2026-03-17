// store/store.ts
// Redux store — configured with redux-persist for offline state survival.
// Persists: library (downloads, favorites, playlists, history, settings).

import { configureStore, combineReducers } from '@reduxjs/toolkit';
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';

import libraryReducer from './library';

// ─────────────────────────────────────────────────────────────────────────────
// Persist config
// ─────────────────────────────────────────────────────────────────────────────

const libraryPersistConfig = {
  key: 'library',
  version: 1,
  storage: AsyncStorage,
  // Exclude volatile/computed state from persistence
  blacklist: ['isScanning', 'scanProgress', 'activeDownloads', 'loading'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Root reducer
// ─────────────────────────────────────────────────────────────────────────────

const rootReducer = combineReducers({
  library: persistReducer(libraryPersistConfig, libraryReducer),
  // Add other slices here as your app grows:
  // player: playerReducer,
  // auth: authReducer,
});

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // redux-persist dispatches non-serialisable actions — ignore them
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;