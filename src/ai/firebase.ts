// Firebase set-up: the app, App Check (required by Firebase AI Logic) and the AI Logic service.
// The web config comes from .env (see .env.example) and is never committed.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

// Each value is read by its full name, so Vite puts only that value into the build. Never copy import.meta.env into
// a variable: Vite would then ship every VITE_ value it loaded, whatever the code uses.

/** True when a real Firebase project is configured. Without one the app still reads on the device. */
export const cloudConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_APP_ID,
);

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'not-set',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'not-set.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'not-set',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:0:web:0',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
};

export const app: FirebaseApp = initializeApp(config);

// App Check: reCAPTCHA Enterprise on the hosted site; the debug provider only in the development server, where the
// developer registers the printed debug token in the Firebase console. A production build drops this branch and the
// token with it, and the token belongs in .env.development.local, which a production build never loads.
if (cloudConfigured) {
  if (import.meta.env.DEV) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || 'not-set'),
    isTokenAutoRefreshEnabled: true,
  });
}

export const ai: AI = getAI(app, { backend: new GoogleAIBackend() });

/** The cloud models, the switch for second opinions and the cloud calls one browser may make in a day. */
export interface Settings {
  cloudModel: string;
  secondOpinionModel: string;
  secondOpinion: boolean;
  maxCloudCallsPerDay: number;
}

export const SETTINGS: Settings = {
  cloudModel: 'gemini-3.5-flash-lite',
  secondOpinionModel: 'gemini-3.6-flash',
  secondOpinion: true,
  maxCloudCallsPerDay: 60,
};
