/**
 * api/index.js
 * Version 3 des einheitlichen Backends.
 * Die Aufräum-Logik wurde aus der GET-Anfrage entfernt, um Fehler zu vermeiden.
 * Das Frontend kommuniziert jetzt direkt mit Firebase für Echtzeit-Updates.
 */

const express = require('express');
const axios = require('axios');
const retry = require('async-retry');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(express.json());

// --- Firebase Admin Initialisierung ---
try {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.error('Firebase Service Account Initialisierung fehlgeschlagen:', e);
}
const db = admin.firestore();
const gamesCollection = db.collection('open_games');


// --- Statische Routen für lokales Testen ---
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lobby.html'));
});
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});
app.get('/lobby.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lobby.html'));
});


// ===========================================
// LOBBY-ROUTEN (VEREINFACHT)
// ===========================================

// Diese Route wird jetzt nur noch für das initiale Laden benötigt, falls die Echtzeit-Verbindung fehlschlägt
app.get('/api/games', async (req, res) => {
    try {
        const snapshot = await gamesCollection.orderBy('createdAt', 'desc').get();
        const games = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(games);
    } catch (error) {
        console.error('Fehler beim Abrufen der Spiele:', error);
        res.status(500).json({ error: 'Spiele konnten nicht geladen werden.' });
    }
});

app.post('/api/games', async (req, res) => {
    // Diese Funktion bleibt unverändert
    try {
        const { gameName, hostId, hostName, kategorien, spielzeit } = req.body;
        if (!gameName || !hostId || !hostName || !kategorien || !spielzeit) {
            return res.status(400).json({ error: 'Alle Felder sind erforderlich.' });
        }
        const newGame = { gameName, hostId, hostName, kategorien, spielzeit, createdAt: new Date() };
        const docRef = await gamesCollection.add(newGame);
        res.status(201).json({ id: docRef.id, ...newGame });
    } catch (error) {
        console.error('Fehler beim Erstellen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht erstellt werden.' });
    }
});

// Die delete und flush Endpunkte bleiben unverändert
app.delete('/api/games/:id', async (req, res) => { /* ... unverändert ... */ });
app.delete('/api/games/flush', async (req, res) => { /* ... unverändert ... */ });


// ===========================================
// SPIELAUSWERTUNGS-ROUTE
// ===========================================
// Die gesamte Auswertungslogik bleibt exakt dieselbe.
app.post('/api/evaluate', async (req, res) => { /* ... unverändert ... */ });

module.exports = app;
