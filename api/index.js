/**
 * api/index.js
 * NEU: Implementiert die syntaktische "Block"-Funktion vor der KI-Validierung.
 */

const express = require('express');
const axios = require('axios');
const retry = require('async-retry');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(express.json());

// --- Firebase & Statische Routen (unverändert) ---
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

// --- Lobby-API Routen (unverändert) ---
app.get('/api/games', async (req, res) => { /* ... */ });
app.post('/api/games', async (req, res) => { /* ... */ });
app.delete('/api/games/flush', async (req, res) => { /* ... */ });
app.delete('/api/games/:id', async (req, res) => { /* ... */ });

// ===========================================
// SPIELAUSWERTUNGS-ROUTE (mit Block-Logik)
// ===========================================
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;

function getValidationResult(validationData, spielerName, kategorieName) { /* ... unverändert ... */ }

app.post('/api/evaluate', async (req, res) => {
    let { buchstabe, kategorien, spieler_antworten } = req.body;
    
    // --- NEUE BLOCK-LOGIK (Phase 1: Vorverarbeitung) ---
    const blockIndex = kategorien.findIndex(k => k.toLowerCase() === 'block');
    let blockWoerter = new Set();
    
    if (blockIndex !== -1) {
        // Sammle alle Block-Wörter
        for (const spieler in spieler_antworten) {
            const blockWort = spieler_antworten[spieler][blockIndex];
            if (blockWort) {
                blockWoerter.add(blockWort.trim().toLowerCase());
            }
        }

        // Erstelle eine neue (bereinigte) Liste von Antworten
        const bereinigte_antworten = {};
        for (const spieler in spieler_antworten) {
            bereinigte_antworten[spieler] = spieler_antworten[spieler]
                .slice(0, blockIndex) // Nimm nur die echten Kategorien
                .map(antwort => {
                    const normalisierteAntwort = antwort.trim().toLowerCase();
                    // Wenn die Antwort einem Block-Wort entspricht, ersetze sie
                    return blockWoerter.has(normalisierteAntwort) ? "" : antwort;
                });
        }
        spieler_antworten = bereinigte_antworten; // Überschreibe die originalen Antworten
        kategorien.splice(blockIndex, 1); // Entferne "Block" aus der Kategorie-Liste
    }
    // --- ENDE DER BLOCK-LOGIK ---

    if (!buchstabe || !kategorien || !spieler_antworten || !API_KEY) {
        return res.status(400).json({ error: 'Fehlende Daten oder Server-Konfiguration.' });
    }
    const prompt = `... (Der Prompt bleibt unverändert, erhält aber jetzt die bereinigten Daten) ...`;
    const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } };

    try {
        const geminiResponse = await retry(async () => axios.post(API_URL, requestBody, { timeout: 20000 }), { retries: 1 });
        const validationData = JSON.parse(geminiResponse.data.candidates[0].content.parts[0].text);
        
        // Die restliche Punktevergabe-Logik funktioniert jetzt automatisch mit den bereinigten Daten
        const punkteTabelle = {};
        const spielerNamen = Object.keys(spieler_antworten);
        // ... (restliche Punkte-Logik bleibt unverändert) ...

        const finaleTabelle = spielerNamen.map(spieler => ({
            spieler: spieler,
            antworten: spieler_antworten[spieler],
            punkte: punkteTabelle[spieler]
        }));
        res.json({ tabelle: finaleTabelle });
    } catch (error) {
        console.error(`Fehler bei der Auswertung: ${error.message}`);
        res.status(502).json({ error: 'Fehler bei der Auswertung.' });
    }
});

module.exports = app;
