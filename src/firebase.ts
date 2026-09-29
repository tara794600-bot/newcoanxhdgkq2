import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
}

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
)

if (!import.meta.env.SSR && !isFirebaseConfigured) {
  console.warn(
    '[firebase] 환경 변수가 비어 있습니다. .env 파일에 VITE_FIREBASE_* 값을 채운 뒤 다시 시작하세요.',
  )
}

// Static rendering never executes effects or event handlers that use Firebase.
const app = import.meta.env.SSR ? null : initializeApp(firebaseConfig)

export const auth = import.meta.env.SSR ? null! : getAuth(app!)
export const db = import.meta.env.SSR ? null! : getFirestore(app!)
export const storage = import.meta.env.SSR ? null! : getStorage(app!)
