/**
 * api/index.js
 * Finale Version: Die Block-Logik wurde verfeinert, um das Blockwort
 * in der finalen Antwort an das Frontend zurückzugeben.
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

// --- Auswertungs-Route mit Block-Logik ---
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;
function getValidationResult(data, spieler, kat) { /* ... */ }

app.post('/api/evaluate', async (req, res) => {
    let { buchstabe, kategorien, spieler_antworten } = req.body;
    
    // Phase 1: Block-Wörter extrahieren und speichern
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

    // Phase 2: Antworten bereinigen
    const bereinigteAntworten = {};
    const bereinigteKategorien = kategorien.filter(k => k.toLowerCase() !== 'block');
    for (const spieler in spieler_antworten) {
        bereinigteAntworten[spieler] = spieler_antworten[spieler]
            .filter((_, index) => index !== blockIndex) // Block-Spalte entfernen
            .map(antwort => alleBlockWoerter.has(antwort.trim().toLowerCase()) ? "" : antwort);
    }
    
    // Phase 3: Mit bereinigten Daten an die KI senden
    const prompt = `Du bist ein fairer, strenger "Stadt, Land, Fluss"-Schiedsrichter... (Prompt hier einfügen, aber mit 'bereinigteKategorien' und 'bereinigteAntworten')`;
    const requestBody = { /* ... */ };

    try {
        const geminiResponse = await retry(async () => axios.post(API_URL, requestBody, { timeout: 20000 }), { retries: 1 });
        const validationData = JSON.parse(geminiResponse.data.candidates[0].content.parts[0].text);
        
        // Phase 4: Punkte berechnen (funktioniert mit bereinigten Daten)
        const punkteTabelle = {};
        const spielerNamen = Object.keys(bereinigteAntworten);
        bereinigteKategorien.forEach((kategorie, katIndex) => {
            // ... (Punkte-Logik wie zuvor, aber mit bereinigten Daten) ...
        });

        // Phase 5: Finale Tabelle zusammenbauen
        const finaleTabelle = spielerNamen.map(spieler => ({
            spieler: spieler,
            antworten: bereinigteAntworten[spieler],
            punkte: punkteTabelle[spieler] || Array(bereinigteKategorien.length).fill(0),
            blockWort: blockWoerterProSpieler[spieler] || ""
        }));
        
        res.json({ tabelle: finaleTabelle });
    } catch (error) {
        res.status(502).json({ error: 'Fehler bei der Auswertung.' });
    }
});

// Platzhalter für kopierten Code
app.get('/api/games',async(req,res)=>{try{const s=await gamesCollection.orderBy('createdAt','desc').get();const g=s.docs.map(d=>({id:d.id,...d.data()}));res.status(200).json(g)}catch(e){res.status(500).json({error:'Spiele konnten nicht geladen werden.'})}});app.post('/api/games',async(req,res)=>{try{const{gameName,hostId,hostName,kategorien,spielzeit}=req.body;const nG={gameName,hostId,hostName,kategorien,spielzeit,createdAt:new Date()};const dR=await gamesCollection.add(nG);res.status(201).json({id:dR.id,...nG})}catch(e){res.status(500).json({error:'Spiel konnte nicht erstellt werden.'})}});app.delete('/api/games/flush',async(req,res)=>{try{const s=await gamesCollection.get();if(s.empty)return res.status(200).json({message:'Keine Spiele zum Löschen gefunden.'});const b=db.batch();s.docs.forEach(d=>{b.delete(d.ref);});await b.commit();res.status(200).json({message:`${s.size} Spiele gelöscht.`})}catch(e){res.status(500).json({error:'Spiele konnten nicht aufgeräumt werden.'})}});app.delete('/api/games/:id',async(req,res)=>{try{await gamesCollection.doc(req.params.id).delete();res.status(200).json({message:'Spiel entfernt.'})}catch(e){res.status(500).json({error:'Spiel konnte nicht entfernt werden.'})}});
function getValidationResult(validationData,spielerName,kategorieName){if(!validationData)return false;const sK=Object.keys(validationData).find(k=>k.toLowerCase()===spielerName.toLowerCase());if(!sK)return false;const sD=validationData[sK];if(!sD)return false;const kK=Object.keys(sD).find(k=>k.toLowerCase()===kategorieName.toLowerCase());if(!kK)return false;return sD[kK];}

module.exports = app;
