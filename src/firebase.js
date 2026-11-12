import {initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth} from 'firebase/auth';

const config = {
  "apiKey": "AIzaSyAJH2Cofhid948RdxX4qgKbejPNJE4JN6w",
  "authDomain": "gestaomona-60d33.firebaseapp.com",
  "projectId": "gestaomona-60d33",
  "appId": "1:952775053492:web:cfd3dd73054cc9075307e1"
};
export const auth = getAuth(initializeApp(config));
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
}

