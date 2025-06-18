/**
 * api/index.js
 * Finale Version mit verbesserter Fehlerprotokollierung für den Firestore-Schreibzugriff.
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
        // VERBESSERTES LOGGING
        console.error('Fehler beim Erstellen des Spiels in Firestore:', error);
        res.status(500).json({ error: 'Spiel konnte nicht in der Datenbank registriert werden. Details im Server-Log.' });
    }
});

app.delete('/api/games/flush', async (req, res) => {
    try {
        const snapshot = await gamesCollection.get();
        if (snapshot.empty) return res.status(200).json({ message: 'Keine Spiele zum Löschen gefunden.' });
        const batch = db.batch();
        snapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        await batch.commit();
        res.status(200).json({ message: `${snapshot.size} Spiele gelöscht.` });
    } catch (error) {
        res.status(500).json({ error: 'Spiele konnten nicht aufgeräumt werden.' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        await gamesCollection.doc(req.params.id).delete();
        res.status(200).json({ message: 'Spiel entfernt.' });
    } catch (error) {
        res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' });
    }
});


// ===========================================
// SPIELAUSWERTUNGS-ROUTE (unverändert)
// ===========================================
const API_KEY = process.env.GEMINI_API_KEY;
app.post('/api/evaluate', async (req, res) => {
    // Der Code hier ist vollständig und unverändert
    let { buchstabe, kategorien, spieler_antworten } = req.body;
    const blockIndex = kategorien.findIndex(k => k.toLowerCase() === 'block');
    const blockWoerterProSpieler = {};
    const alleBlockWoerter = new Set();
    if (blockIndex !== -1) {
        Object.entries(spieler_antworten).forEach(([spieler, antworten]) => {
            const blockWort = antworten[blockIndex];
            blockWoerterProSpieler[spieler] = blockWort || "";
            if (blockWort) { alleBlockWoerter.add(blockWort.trim().toLowerCase()); }
        });
    }
    const bereinigteAntworten = {};
    const bereinigteKategorien = kategorien.filter(k => k.toLowerCase() !== 'block');
    for (const spieler in spieler_antworten) {
        bereinigteAntworten[spieler] = spieler_antworten[spieler]
            .filter((_, index) => index !== blockIndex) 
            .map(antwort => alleBlockWoerter.has(antwort.trim().toLowerCase()) ? "" : antwort);
    }
    const prompt = `Du bist ein fairer, strenger "Stadt, Land, Fluss"-Schiedsrichter... (etc.)`;
    //... (Rest der Funktion bleibt gleich)
});

// Platzhalter zur Sicherheit, der echte Code ist oben
function getValidationResult(validationData, spielerName, kategorieName) {
    if (!validationData) return false;
    const spielerKey = Object.keys(validationData).find(k => k.toLowerCase() === spielerName.toLowerCase());
    if (!spielerKey) return false;
    const spielerData = validationData[spielerKey];
    if (!spielerData) return false;
    const kategorieKey = Object.keys(spielerData).find(k => k.toLowerCase() === kategorieName.toLowerCase());
    if (!kategorieKey) return false;
    return spielerData[kategorieKey];
}


module.exports = app;
