/**
 * api/index.js
 * Finale Version: Der Prompt wird jetzt aus einer externen Textdatei geladen,
 * um Konfiguration und Code sauber zu trennen.
 */

const express = require('express');
const axios = require('axios');
const retry = require('async-retry');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs'); // Node.js File System Modul
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

// --- Lobby-API Routen (unverändert) ---
app.get('/api/games', async (req, res) => { /* ... unverändert ... */ });
app.post('/api/games', async (req, res) => { /* ... unverändert ... */ });
app.delete('/api/games/flush', async (req, res) => { /* ... unverändert ... */ });
app.delete('/api/games/:id', async (req, res) => { /* ... unverändert ... */ });

// ===========================================
// SPIELAUSWERTUNGS-ROUTE
// ===========================================
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;
function getValidationResult(data, spieler, kat) { /* ... unverändert ... */ }

app.post('/api/evaluate', async (req, res) => {
    let { buchstabe, kategorien, spieler_antworten } = req.body;
    
    // Block-Logik bleibt unverändert
    const blockIndex = kategorien.findIndex(k => k.toLowerCase() === 'block');
    const blockWoerterProSpieler = {};
    const alleBlockWoerter = new Set();
    if (blockIndex !== -1) { /* ... Block-Logik unverändert ... */ }
    const bereinigteAntworten = {};
    const bereinigteKategorien = kategorien.filter(k => k.toLowerCase() !== 'block');
    for (const spieler in spieler_antworten) { /* ... Bereinigungs-Logik unverändert ... */ }
    
    try {
        // NEU: Lade den Prompt-Template aus der Textdatei
        const promptTemplatePath = path.join(__dirname, '..', 'prompt-template.txt');
        let promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');

        // Fülle die Platzhalter im Template aus
        let prompt = promptTemplate
            .replace(/\${buchstabe}/g, buchstabe)
            .replace(/\${kategorien}/g, bereinigteKategorien.join(', '))
            .replace(/\${spieler_antworten}/g, JSON.stringify(bereinigteAntworten));
        
        const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } };
        
        const geminiResponse = await retry(async () => axios.post(API_URL, requestBody, { timeout: 20000 }), { retries: 1 });
        const validationData = JSON.parse(geminiResponse.data.candidates[0].content.parts[0].text);
        
        // Die Punkte-Logik bleibt unverändert
        const punkteTabelle = {};
        const spielerNamen = Object.keys(bereinigteAntworten);
        bereinigteKategorien.forEach((kategorie, katIndex) => { /* ... Punkte-Logik unverändert ... */ });

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

// Platzhalter für den vollständigen Code, der in den obigen Kommentaren ausgelassen wurde
app.get('/api/games',async(req,res)=>{try{const s=await gamesCollection.orderBy('createdAt','desc').get();const g=s.docs.map(d=>({id:d.id,...d.data()}));res.status(200).json(g)}catch(e){res.status(500).json({error:'Spiele konnten nicht geladen werden.'})}});
app.post('/api/games',async(req,res)=>{try{const{gameName,hostId,hostName,kategorien,spielzeit}=req.body;const nG={gameName,hostId,hostName,kategorien,spielzeit,createdAt:new Date()};const dR=await gamesCollection.add(nG);res.status(201).json({id:dR.id,...nG})}catch(e){res.status(500).json({error:'Spiel konnte nicht erstellt werden.'})}});
app.delete('/api/games/flush',async(req,res)=>{try{const s=await gamesCollection.get();if(s.empty)return res.status(200).json({message:'Keine Spiele zum Löschen gefunden.'});const b=db.batch();s.docs.forEach(d=>{b.delete(d.ref);});await b.commit();res.status(200).json({message:`${s.size} Spiele gelöscht.`})}catch(e){res.status(500).json({error:'Spiele konnten nicht aufgeräumt werden.'})}});
app.delete('/api/games/:id',async(req,res)=>{try{await gamesCollection.doc(req.params.id).delete();res.status(200).json({message:'Spiel entfernt.'})}catch(e){res.status(500).json({error:'Spiel konnte nicht entfernt werden.'})}});
function getValidationResult(validationData,spielerName,kategorieName){if(!validationData)return false;const sK=Object.keys(validationData).find(k=>k.toLowerCase()===spielerName.toLowerCase());if(!sK)return false;const sD=validationData[sK];if(!sD)return false;const kK=Object.keys(sD).find(k=>k.toLowerCase()===kategorieName.toLowerCase());if(!kK)return false;return sD[kK];}
if(blockIndex!==-1){Object.entries(spieler_antworten).forEach(([s,a])=>{const bW=a[blockIndex];if(bW)alleBlockWoerter.add(bW.trim().toLowerCase());blockWoerterProSpieler[s]=bW||"";});}
for(const s in spieler_antworten){bereinigteAntworten[s]=spieler_antworten[s].filter((_,i)=>i!==blockIndex).map(a=>alleBlockWoerter.has(a.trim().toLowerCase())?"":a);}
bereinigteKategorien.forEach((k,kI)=>{const gADR={};Object.keys(bereinigteAntworten).forEach(sN=>{const a=bereinigteAntworten[sN][kI];const iG=getValidationResult(validationData,sN,k);if(a&&iG){const nA=a.trim().toLowerCase();if(!gADR[nA])gADR[nA]=[];gADR[nA].push(sN);}});Object.keys(bereinigteAntworten).forEach(sN=>{if(!punkteTabelle[sN])punkteTabelle[sN]=Array(bereinigteKategorien.length).fill(0);const a=bereinigteAntworten[sN][kI];const nA=a.trim().toLowerCase();const sMDA=gADR[nA];if(sMDA){if(sMDA.length===1)punkteTabelle[sN][kI]=20;else if(sMDA.length===Object.keys(bereinigteAntworten).length&&Object.keys(bereinigteAntworten).length>1)punkteTabelle[sN][kI]=5;else punkteTabelle[sN][kI]=10;}});});

module.exports = app;
