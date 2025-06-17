/**
 * api/index.js
 * Dies ist das finale, einheitliche Backend, das alle API-Routen verwaltet.
 * Es ersetzt api/evaluate.js und api/games.js.
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
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// --- API-Konstanten ---
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;


// ===========================================
// ROUTEN AUS DEM ALTEN games.js
// ===========================================

app.get('/api/games', async (req, res) => {
    try {
        const oneHourAgo = new Date(Date.now() - 3600000);
        const oldGamesQuery = gamesCollection.where('createdAt', '<', oneHourAgo);
        const oldGamesSnapshot = await oldGamesQuery.get();
        if (!oldGamesSnapshot.empty) {
            const batch = db.batch();
            oldGamesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        
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
        const { gameName, hostId, hostName } = req.body;
        if (!gameName || !hostId || !hostName) {
            return res.status(400).json({ error: 'Spielname, Host-ID und Host-Name sind erforderlich.' });
        }
        const newGame = { gameName, hostId, hostName, createdAt: new Date() };
        const docRef = await gamesCollection.add(newGame);
        res.status(201).json({ id: docRef.id, ...newGame });
    } catch (error) {
        console.error('Fehler beim Erstellen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht erstellt werden.' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        await gamesCollection.doc(req.params.id).delete();
        res.status(200).json({ message: 'Spiel erfolgreich entfernt.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' });
    }
});

// ===========================================
// ROUTE AUS DEM ALTEN evaluate.js
// ===========================================

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
    const { buchstabe, kategorien, spieler_antworten } = req.body;

    if (!buchstabe || !kategorien || !spieler_antworten) {
        return res.status(400).json({ error: 'Fehlende Daten.' });
    }
    if (!API_KEY) {
        return res.status(500).json({ error: 'Server-Fehler: API-Schlüssel nicht konfiguriert.' });
    }

    const prompt = `Du bist ein fairer, konsistenter und strenger "Stadt, Land, Fluss"-Schiedsrichter. Deine Hauptaufgabe ist es, die Regeln genau anzuwenden und Schummeln zu verhindern, aber gleichzeitig gebräuchliches Allgemeinwissen zu akzeptieren. Bewerte die folgenden Antworten für den Buchstaben "${buchstabe}". Regeln: 1. Korrekte Schreibweise: Keine Tippfehler. 2. Exakter Anfangsbuchstabe: Muss mit "${buchstabe}" beginnen. 3. Gültigkeit der Kategorie: Muss eindeutig in die Kategorie passen. 4. Singular und Plural: Beide Formen sind gültig (z.B. "Lachs" und "Lachse"). 5. Allgemeinwissen: Gebräuchliche Namen sind gültig (z.B. "Irland"). Sei nicht pedantisch. 6. Leere Antworten: Sind immer ungültig. Die Kategorien sind: ${kategorien.join(', ')}. Die Antworten der Spieler sind: ${JSON.stringify(spieler_antworten)} Gib deine Antwort AUSSCHLIESSLICH im folgenden JSON-Format zurück: { "Spieler 1": { "Stadt": true, "Land": false } }`;
    
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
                    if (!gueltigeAntwortenDieserRunde[normalisierteAntwort]) {
                        gueltigeAntwortenDieserRunde[normalisierteAntwort] = [];
                    }
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
        console.error(`Fehler bei der Verarbeitung von /api/evaluate: ${error.message}`);
        res.status(502).json({ error: 'Fehler bei der Auswertung. Möglicherweise eine ungültige API-Antwort.' });
    }
});


// Exportiert die gesamte `app` für Vercel. Vercel startet den Server selbst.
module.exports = app;
