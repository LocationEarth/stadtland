/**
 * api/games.js
 * Dieses neue Backend-Skript verwaltet die Spiele-Lobby mit Firebase Firestore.
 */
const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// --- Firebase Admin Initialisierung ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.error('Firebase Service Account Initialisierung fehlgeschlagen:', e);
}
const db = admin.firestore();
const gamesCollection = db.collection('open_games');


// --- API Endpunkte ---

// 1. Liste aller offenen Spiele abrufen
app.get('/api/games', async (req, res) => {
    try {
        // Lösche Spiele, die älter als 1 Stunde sind, um die DB sauber zu halten
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const oldGamesQuery = gamesCollection.where('createdAt', '<', oneHourAgo);
        const oldGamesSnapshot = await oldGamesQuery.get();
        const batch = db.batch();
        oldGamesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Hole die verbleibenden Spiele
        const snapshot = await gamesCollection.orderBy('createdAt', 'desc').get();
        const games = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(games);
    } catch (error) {
        console.error('Fehler beim Abrufen der Spiele:', error);
        res.status(500).json({ error: 'Spiele konnten nicht geladen werden.' });
    }
});

// 2. Ein neues Spiel erstellen (auf dem "Schwarzen Brett" anheften)
app.post('/api/games', async (req, res) => {
    try {
        const { gameName, hostId, hostName } = req.body;
        if (!gameName || !hostId || !hostName) {
            return res.status(400).json({ error: 'Spielname, Host-ID und Host-Name sind erforderlich.' });
        }
        const newGame = {
            gameName,
            hostId,
            hostName,
            playerCount: 1,
            createdAt: new Date()
        };
        const docRef = await gamesCollection.add(newGame);
        res.status(201).json({ id: docRef.id, ...newGame });
    } catch (error) {
        console.error('Fehler beim Erstellen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht erstellt werden.' });
    }
});

// 3. Ein Spiel löschen (wenn es startet)
app.delete('/api/games/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await gamesCollection.doc(id).delete();
        res.status(200).json({ message: 'Spiel erfolgreich entfernt.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Spiels:', error);
        res.status(500).json({ error: 'Spiel konnte nicht entfernt werden.' });
    }
});


if (process.env.NODE_ENV !== 'test') {
    const PORT = process.env.PORT || 3001; // Anderer Port, falls lokal beide laufen
    app.listen(PORT, () => console.log(`Games-Server läuft lokal auf Port ${PORT}.`));
}

module.exports = app;
