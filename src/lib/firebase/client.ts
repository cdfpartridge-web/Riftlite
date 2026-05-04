"use client";

import { getApps, initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBNqEY-i_CggjhDKVltoPQFrSOEfHF7fBA",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "riftlite-b61a5.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "riftlite-b61a5",
};

export const firebaseClientApp = getApps()[0] ?? initializeApp(firebaseConfig);
