// firebase-config.js
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDugu23uEgacqMUTsoBF8i7xfyDIDbiv0M",
    authDomain: "bar-inventario-1109e.firebaseapp.com",
    projectId: "bar-inventario-1109e",
    storageBucket: "bar-inventario-1109e.firebasestorage.app",
    messagingSenderId: "450765028668",
    appId: "1:450765028668:web:54fdb19714d374ff02b239"
};

export const FIRESTORE_DOC_ID = "barra-principal";

// Inicializar solo si no se ha inicializado antes
if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}

const db = firebase.firestore();
const auth = firebase.auth();

// Activar persistencia offline para entornos con Wi-Fi inestable
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn("[Firebase] Persistencia offline no disponible (múltiples pestañas abiertas).");
    } else if (err.code === 'unimplemented') {
        console.warn("[Firebase] Este navegador no soporta persistencia offline.");
    }
});

export { db, auth };