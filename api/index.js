/**
 * api/index.js
 * Version 9 des einheitlichen Backends.
 * NEU: Debug-Nachricht in der /flush Route, um zu überprüfen, ob sie aufgerufen wird.
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
    console.error('Firebase Service Account Initialisierung fehlgeschlagen.', e);
}
const db = admin.firestore();
const gamesCollection = db.collection('open_games');


// --- Statische Routen ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'lobby.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/lobby.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'lobby.html')));


// ===========================================
// LOBBY-API ROUTEN
// ===========================================

app.get('/api/games', async (req, res) => {
    try {
        const snapshot = await gamesCollection.orderBy('createdAt', 'desc').get();
        const games = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(games);
    } catch (error) {
        res.status(500).json({ error: 'Spiele konnten nicht geladen werden.' });
    }
});

app.post('/api/games', async (req, res) => {
    try {
        const { gameName, hostId, hostName, kategorien, spielzeit } = req.body;
        if (!gameName || !hostId || !hostName || !kategorien || !spielzeit) {
            return res.status(400).json({ error: 'Alle Felder sind erforderlich.' });
        }
        const newGame = { gameName, hostId, hostName, kategorien, spielzeit, createdAt: new Date() };
        const docRef = await gamesCollection.add(newGame);
        res.status(201).json({ id: docRef.id, ...newGame });
    } catch (error) {
        res.status(500).json({ error: 'Spiel konnte nicht erstellt werden.' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        await gamesCollection.doc(req.params.id).delete();
        res.status(200).json({ message: 'Spiel erfolgreich entfernt.' });
    } catch (error) {
        res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' });
    }
});

// NEUER DEBUG-LOG HIER
app.delete('/api/games/flush', async (req, res) => {
    console.log("DEBUG: /api/games/flush aufgerufen."); // Unser "Spürhund"
    try {
        const snapshot = await gamesCollection.get();
        if (snapshot.empty) {
            console.log("DEBUG: Keine Spiele zum Löschen gefunden.");
            return res.status(200).json({ message: 'Keine alten Spiele zum Löschen gefunden.' });
        }
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`DEBUG: ${snapshot.size} Spiele gelöscht.`);
        res.status(200).json({ message: `${snapshot.size} alte Spiele wurden erfolgreich gelöscht.` });
    } catch (error) {
        console.error('Fehler beim Aufräumen der Spiele:', error);
        res.status(500).json({ error: 'Spiele konnten nicht aufgeräumt werden.' });
    }
});


// ===========================================
// SPIELAUSWERTUNGS-ROUTE
// ===========================================
// Dieser Teil bleibt unverändert.
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;
app.post('/api/evaluate', async (req, res) => { /* ... unverändert ... */ });


module.exports = app;
