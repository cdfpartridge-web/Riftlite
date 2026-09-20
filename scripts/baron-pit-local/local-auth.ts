export const firebaseClientApp = Object.freeze({ localPreview: true });
const auth = Object.freeze({ currentUser: null, authStateReady: async () => undefined });
export function getAuth() { return auth; }
