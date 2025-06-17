/**
 * api/index.js
 * Dies ist das finale, einheitliche Backend, das alle API-Routen verwaltet.
 * Es ersetzt die vorher getrennten Dateien api/evaluate.js und api/games.js.
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
// Initialisiert die Verbindung zur Datenbank nur, wenn sie noch nicht besteht.
try {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.error('Firebase Service Account Initialisierung fehlgeschlagen. Überprüfen Sie die Umgebungsvariable in Vercel.', e);
}
const db = admin.firestore();
const gamesCollection = db.collection('open_games');


// --- Statische Routen für lokales Testen & direkten Aufruf ---
// Diese sorgen dafür, dass beim Aufruf der Haupt-URL die Lobby angezeigt wird.
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
// LOBBY-API ROUTEN
// ===========================================

// Ruft alle offenen Spiele aus der Datenbank ab.
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

// Erstellt ein neues Spiel in der Lobby-Datenbank.
app.post('/api/games', async (req, res) => {
    try {
        const { gameName, hostId, hostName, kategorien, spielzeit } = req.body;
        if (!gameName || !hostId || !hostName || !kategorien || !spielzeit) {
            return res.status(400).json({ error: 'Alle Felder (Spielname, Host-ID, Host-Name, Kategorien, Spielzeit) sind erforderlich.' });
        }
        const newGame = { gameName, hostId, hostName, kategorien, spielzeit, createdAt: new Date() };
        const docRef = await gamesCollection.add(newGame);
        res.status(201).json({ id: docRef.id, ...newGame });
    } catch (error) {
        console.error('Fehler beim Erstellen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht erstellt werden.' });
    }
});

// Löscht ein spezifisches Spiel aus der Lobby (wenn es startet).
app.delete('/api/games/:id', async (req, res) => {
    try {
        await gamesCollection.doc(req.params.id).delete();
        res.status(200).json({ message: 'Spiel erfolgreich aus der Lobby entfernt.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' });
    }
});

// Löscht ALLE Spiele aus der Lobby (Aufräum-Funktion).
app.delete('/api/games/flush', async (req, res) => {
    try {
        const snapshot = await gamesCollection.get();
        if (snapshot.empty) {
            return res.status(200).json({ message: 'Keine alten Spiele zum Löschen gefunden.' });
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


// ===========================================
// SPIELAUSWERTUNGS-ROUTE
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
    const { buchstabe, kategorien, spieler_antworten } = req.body;
    if (!buchstabe || !kategorien || !spieler_antworten || !API_KEY) {
        return res.status(400).json({ error: 'Fehlende Daten oder Server-Konfiguration.' });
    }
    const prompt = `Du bist ein fairer, konsistenter und strenger "Stadt, Land, Fluss"-Schiedsrichter. Deine Hauptaufgabe ist es, die Regeln genau anzuwenden und Schummeln zu verhindern, aber gleichzeitig gebräuchliches Allgemeinwissen zu akzeptieren. Bewerte die folgenden Antworten für den Buchstaben "${buchstabe}". Regeln: 1. Korrekte Schreibweise: Keine Tippfehler. "Berliin" ist ungültig. 2. Exakter Anfangsbuchstabe: Muss mit "${buchstabe}" beginnen. Das Verändern des Anfangsbuchstabens (z.B. "Cänguruh" für "C") ist verboten. 3. Gültigkeit der Kategorie: Muss eindeutig in die Kategorie passen. 4. Singular und Plural: Korrekt gebildete Singular- und Pluralformen sind beide gültig (z.B. "Lachs" und "Lachse"). 5. Allgemeinwissen: Gebräuchliche Namen sind gültig (z.B. "Irland"). Sei nicht pedantisch. 6. Leere Antworten: Sind immer ungültig. Die Kategorien sind: ${kategorien.join(', ')}. Die Antworten der Spieler sind: ${JSON.stringify(spieler_antworten)} Gib deine Antwort AUSSCHLIESSLICH im folgenden JSON-Format zurück, ohne weiteren Text: { "Spieler 1": { "Stadt": true, "Land": false }, "Spieler 2": { "Stadt": true, "Land": true } }`;
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
        console.error(`Fehler bei der Verarbeitung von /api/evaluate: ${error.message}`);
        res.status(502).json({ error: 'Fehler bei der Auswertung. Möglicherweise eine ungültige API-Antwort.' });
    }
});

// Exportiert die gesamte `app` für Vercel. Vercel startet den Server selbst.
module.exports = app;
