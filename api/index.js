/**
 * api/index.js
 * Vollständige Version mit syntaktischer "Block"-Funktion vor der KI-Validierung.
 */

const express = require('express');
const axios = require('axios');
const retry = require('async-retry');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(express.json());

// --- Firebase & Statische Routen ---
try {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
} catch (e) { console.error('Firebase Init Fehler:', e); }
const db = admin.firestore();
const gamesCollection = db.collection('open_games');
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'lobby.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/lobby.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'lobby.html')));

// --- Lobby-API Routen ---
app.get('/api/games', async (req, res) => {
    try {
        const snapshot = await gamesCollection.orderBy('createdAt', 'desc').get();
        const games = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(games);
    } catch (error) { res.status(500).json({ error: 'Spiele konnten nicht geladen werden.' }); }
});
app.post('/api/games', async (req, res) => {
    try {
        const { gameName, hostId, hostName, kategorien, spielzeit } = req.body;
        const newGame = { gameName, hostId, hostName, kategorien, spielzeit, createdAt: new Date() };
        const docRef = await gamesCollection.add(newGame);
        res.status(201).json({ id: docRef.id, ...newGame });
    } catch (error) { res.status(500).json({ error: 'Spiel konnte nicht erstellt werden.' }); }
});
app.delete('/api/games/flush', async (req, res) => {
    try {
        const snapshot = await gamesCollection.get();
        if (snapshot.empty) return res.status(200).json({ message: 'Keine Spiele zum Löschen gefunden.' });
        const batch = db.batch();
        snapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        await batch.commit();
        res.status(200).json({ message: `${snapshot.size} Spiele gelöscht.` });
    } catch (error) { res.status(500).json({ error: 'Spiele konnten nicht aufgeräumt werden.' }); }
});
app.delete('/api/games/:id', async (req, res) => {
    try {
        await gamesCollection.doc(req.params.id).delete();
        res.status(200).json({ message: 'Spiel entfernt.' });
    } catch (error) { res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' }); }
});

// ===========================================
// SPIELAUSWERTUNGS-ROUTE
// ===========================================
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;
function getValidationResult(data, spieler, kat) { /* ... implementiert unten ... */ }

app.post('/api/evaluate', async (req, res) => {
    let { buchstabe, kategorien, spieler_antworten } = req.body;
    
    // --- BLOCK-LOGIK (Vorverarbeitung) ---
    const blockIndex = kategorien.findIndex(k => k.toLowerCase() === 'block');
    const blockWoerter = new Set();
    
    if (blockIndex !== -1) {
        Object.values(spieler_antworten).forEach(antworten_array => {
            const blockWort = antworten_array[blockIndex];
            if (blockWort) blockWoerter.add(blockWort.trim().toLowerCase());
        });

        const bereinigte_antworten = {};
        for (const spieler in spieler_antworten) {
            bereinigte_antworten[spieler] = spieler_antworten[spieler]
                .slice(0, blockIndex)
                .map(antwort => blockWoerter.has(antwort.trim().toLowerCase()) ? "" : antwort);
        }
        spieler_antworten = bereinigte_antworten;
        kategorien.splice(blockIndex, 1);
    }
    // --- ENDE BLOCK-LOGIK ---

    const prompt = `Du bist ein fairer, strenger "Stadt, Land, Fluss"-Schiedsrichter. Bewerte die Antworten für den Buchstaben "${buchstabe}". Regeln: 1. Keine Tippfehler. 2. Exakter Anfangsbuchstabe. 3. Gültige Kategorie. 4. Singular & Plural sind ok. 5. Allgemeinwissen & gebräuchliche Namen (z.B. "Irland") sind ok. Die Kategorien sind: ${kategorien.join(', ')}. Die Antworten: ${JSON.stringify(spieler_antworten)}. Gib deine Antwort NUR als JSON zurück: { "Spieler 1": { "Stadt": true, "Land": false } }`;
    const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } };

    try {
        const geminiResponse = await retry(async () => axios.post(API_URL, requestBody, { timeout: 20000 }), { retries: 1 });
        const validationData = JSON.parse(geminiResponse.data.candidates[0].content.parts[0].text);
        
        const punkteTabelle = {};
        const spielerNamen = Object.keys(spieler_antworten);

        kategorien.forEach((kategorie, katIndex) => {
            const gueltigeAntwortenDieserRunde = {};
            spielerNamen.forEach(spieler => {
                const antwort = spieler_antworten[spieler][katIndex];
                const istGueltig = getValidationResult(validationData, spieler, kategorie);
                if (antwort && istGueltig) {
                    const normalisierteAntwort = antwort.trim().toLowerCase();
                    if (!gueltigeAntwortenDieserRunde[normalisierteAntwort]) gueltigeAntwortenDieserRunde[normalisierteAntwort] = [];
                    gueltigeAntwortenDieserRunde[normalisierteAntwort].push(spieler);
                }
            });

            spielerNamen.forEach(spieler => {
                if (!punkteTabelle[spieler]) punkteTabelle[spieler] = Array(kategorien.length).fill(0);
                const antwort = spieler_antworten[spieler][katIndex];
                const normalisierteAntwort = antwort.trim().toLowerCase();
                const spielerMitDieserAntwort = gueltigeAntwortenDieserRunde[normalisierteAntwort];
                if (spielerMitDieserAntwort) {
                    if (spielerMitDieserAntwort.length === 1) punkteTabelle[spieler][katIndex] = 20;
                    else if (spielerMitDieserAntwort.length === spielerNamen.length && spielerNamen.length > 1) punkteTabelle[spieler][katIndex] = 5;
                    else punkteTabelle[spieler][katIndex] = 10;
                }
            });
        });
        const finaleTabelle = spielerNamen.map(spieler => ({
            spieler: spieler,
            antworten: spieler_antworten[spieler],
            punkte: punkteTabelle[spieler]
        }));
        res.json({ tabelle: finaleTabelle });
    } catch (error) {
        res.status(502).json({ error: 'Fehler bei der Auswertung.' });
    }
});

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
