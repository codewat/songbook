import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import type { CloudConfig } from '../types/models';

const APP_NAME = 'worshipdeck-sync';

export interface FirebaseBundle {
  app: FirebaseApp;
  firestore: Firestore;
  storage: FirebaseStorage | null;
  config: CloudConfig;
}

let cachedBundle: FirebaseBundle | null = null;
let cachedSignature = '';

export function getFirebaseBundle(config: CloudConfig | null): FirebaseBundle | null {
  if (!config?.apiKey || !config?.projectId || !config?.appId) {
    return null;
  }

  const signature = `${config.apiKey}::${config.projectId}::${config.appId}::${config.storageBucket || ''}`;
  if (cachedBundle && cachedSignature === signature) {
    return { ...cachedBundle, config };
  }

  // Clean up any previous named app instance if config changed
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    void deleteApp(existing);
  }

  const app = initializeApp(
    {
      apiKey: config.apiKey,
      authDomain: config.authDomain || `${config.projectId}.firebaseapp.com`,
      projectId: config.projectId,
      storageBucket: config.storageBucket || `${config.projectId}.firebasestorage.app`,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    },
    APP_NAME
  );

  const firestore = getFirestore(app);
  const storage = config.storageBucket ? getStorage(app) : null;

  cachedBundle = { app, firestore, storage, config };
  cachedSignature = signature;
  return cachedBundle;
}

export async function resetFirebaseClientCache(): Promise<void> {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    await deleteApp(existing);
  }
  cachedBundle = null;
  cachedSignature = '';
}
