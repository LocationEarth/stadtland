/**
 * api/index.js
 * Finale, vollständige und korrigierte Version des einheitlichen Backends.
 * Alle Platzhalter wurden durch den funktionierenden Code ersetzt.
 */

const express = require('express');
const axios = require('axios');
const retry = require('async-retry');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());

// --- Firebase Admin Initialisierung ---
try {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
} catch (e) { console.error('Firebase Init Fehler:', e); }
const db = admin.firestore();
const gamesCollection = db.collection('open_games');

// --- Statische Routen ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'lobby.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/lobby.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'lobby.html')));

// ===========================================
// LOBBY-API ROUTEN (VOLLSTÄNDIG)
// ===========================================

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

app.delete('/api/games/flush', async (req, res) => {
    try {
        const snapshot = await gamesCollection.get();
        if (snapshot.empty) {
            return res.status(200).json({ message: 'Keine Spiele zum Löschen gefunden.' });
        }
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        res.status(200).json({ message: `${snapshot.size} alte Spiele wurden erfolgreich gelöscht.` });
    } catch (error) {
        console.error('Fehler beim Aufräumen der Spiele:', error);
        res.status(500).json({ error: 'Spiele konnten nicht aufgeräumt werden.' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        await gamesCollection.doc(req.params.id).delete();
        res.status(200).json({ message: 'Spiel erfolgreich aus der Lobby entfernt.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' });
    }
});

// ===========================================
// SPIELAUSWERTUNGS-ROUTE (VOLLSTÄNDIG)
// ===========================================
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;

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

app.post('/api/evaluate', async (req, res) => {
    let { buchstabe, kategorien, spieler_antworten } = req.body;
    
    const blockIndex = kategorien.findIndex(k => k.toLowerCase() === 'block');
    const blockWoerterProSpieler = {};
    const alleBlockWoerter = new Set();
    if (blockIndex !== -1) {
        Object.entries(spieler_antworten).forEach(([spieler, antworten]) => {
            const blockWort = antworten[blockIndex];
            blockWoerterProSpieler[spieler] = blockWort || "";
            if (blockWort) {
                alleBlockWoerter.add(blockWort.trim().toLowerCase());
            }
        });
    }

    const bereinigteAntworten = {};
    const bereinigteKategorien = kategorien.filter(k => k.toLowerCase() !== 'block');
    for (const spieler in spieler_antworten) {
        bereinigteAntworten[spieler] = spieler_antworten[spieler]
            .filter((_, index) => index !== blockIndex)
            .map(antwort => alleBlockWoerter.has(antwort.trim().toLowerCase()) ? "" : antwort);
    }
    
    try {
        const promptTemplatePath = path.join(__dirname, '..', 'prompt-template.txt');
        let promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');

        let prompt = promptTemplate
            .replace(/\${buchstabe}/g, buchstabe)
            .replace(/\${kategorien}/g, bereinigteKategorien.join(', '))
            .replace(/\${spieler_antworten}/g, JSON.stringify(bereinigteAntworten));
        
        const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } };
        
        const geminiResponse = await retry(async () => axios.post(API_URL, requestBody, { timeout: 20000 }), { retries: 1 });
        const validationData = JSON.parse(geminiResponse.data.candidates[0].content.parts[0].text);
        
        const punkteTabelle = {};
        const spielerNamen = Object.keys(bereinigteAntworten);
        bereinigteKategorien.forEach((kategorie, katIndex) => {
            const gueltigeAntwortenDieserRunde = {};
            spielerNamen.forEach(spieler => {
                const antwort = bereinigteAntworten[spieler][katIndex];
                const istGueltig = getValidationResult(validationData, spieler, kategorie);
                if (antwort && istGueltig) {
                    const normalisierteAntwort = antwort.trim().toLowerCase();
                    if (!gueltigeAntwortenDieserRunde[normalisierteAntwort]) gueltigeAntwortenDieserRunde[normalisierteAntwort] = [];
                    gueltigeAntwortenDieserRunde[normalisierteAntwort].push(spieler);
                }
            });

            spielerNamen.forEach(spieler => {
                if (!punkteTabelle[spieler]) punkteTabelle[spieler] = Array(bereinigteKategorien.length).fill(0);
                const antwort = bereinigteAntworten[spieler][katIndex];
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
            antworten: bereinigteAntworten[spieler],
            punkte: punkteTabelle[spieler] || Array(bereinigteKategorien.length).fill(0),
            blockWort: blockWoerterProSpieler[spieler] || ""
        }));
        
        res.json({ tabelle: finaleTabelle });
    } catch (error) {
        console.error(`Fehler bei der Auswertung: ${error.message}`);
        if (error.code === 'ENOENT') {
            res.status(500).json({ error: 'Server-Konfigurationsfehler: prompt-template.txt nicht gefunden.' });
        } else {
            res.status(502).json({ error: 'Fehler bei der Auswertung.' });
        }
    }
});

module.exports = app;
