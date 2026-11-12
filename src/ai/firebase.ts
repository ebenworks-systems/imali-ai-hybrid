// Firebase set-up: the app, App Check (required by Firebase AI Logic), Remote Config and the AI Logic service.
// The web config comes from .env (see .env.example) and is never committed.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { fetchAndActivate, getRemoteConfig, getValue, type RemoteConfig } from 'firebase/remote-config';

const env = import.meta.env;

/** True when a real Firebase project is configured. Without one the app still reads on the device. */
export const cloudConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'not-set',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'not-set.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'not-set',
  appId: env.VITE_FIREBASE_APP_ID || '1:0:web:0',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
};

export const app: FirebaseApp = initializeApp(config);

// App Check: reCAPTCHA Enterprise on the hosted site; the debug provider on a developer's own machine, where the
// developer registers the printed debug token in the Firebase console (never committed, never shipped).
if (cloudConfigured) {
  if (env.DEV || env.VITE_APPCHECK_DEBUG === 'true') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || 'not-set'),
    isTokenAutoRefreshEnabled: true,
  });
}

export const ai: AI = getAI(app, { backend: new GoogleAIBackend() });

/** Settings the owner of the deployment can change without a release, from Firebase Remote Config. */
export interface Settings {
  cloudModel: string;
  secondOpinionModel: string;
  secondOpinion: boolean;
  maxCloudCallsPerDay: number;
}

export const DEFAULTS: Settings = {
  cloudModel: 'gemini-3.5-flash-lite',
  secondOpinionModel: 'gemini-3.8-flash',
  secondOpinion: true,
  maxCloudCallsPerDay: 60,
};

let rc: RemoteConfig | null = null;

export async function loadSettings(): Promise<Settings> {
  if (!cloudConfigured || !navigator.onLine) return DEFAULTS;
  try {
    rc ??= getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 3_600_000;
    rc.defaultConfig = {
      cloud_model: DEFAULTS.cloudModel,
      second_opinion_model: DEFAULTS.secondOpinionModel,
      second_opinion: DEFAULTS.secondOpinion,
      max_cloud_calls_per_day: DEFAULTS.maxCloudCallsPerDay,
    };
    await fetchAndActivate(rc);
    return {
      cloudModel: getValue(rc, 'cloud_model').asString() || DEFAULTS.cloudModel,
      secondOpinionModel: getValue(rc, 'second_opinion_model').asString() || DEFAULTS.secondOpinionModel,
      secondOpinion: getValue(rc, 'second_opinion').asBoolean(),
      maxCloudCallsPerDay: getValue(rc, 'max_cloud_calls_per_day').asNumber() || DEFAULTS.maxCloudCallsPerDay,
    };
  } catch {
    return DEFAULTS;
  }
}
