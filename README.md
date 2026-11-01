# Reticolo

Gestore locale di librerie 3D per Mac (Apple Silicon) e Windows (x64). Indicizza cartelle, dischi e NAS senza caricare, spostare o rinominare i file.

## Funzioni

- **Formati**: STL, 3MF, OBJ, FBX, STEP/STP, 3DM (anteprima parziale), GLB, PLY, glTF (solo ricerca), G-code/bgcode, Fusion F3D/F3Z, Lychee LYS (sperimentale), xTool XCS/XS, LightBurn, DXF, DWG (anteprima salvata), archivi ZIP/RAR/7Z/TAR/TGZ letti senza estrarli, più immagini, video, PDF, TXT e MD come file di accompagnamento.
- **Visualizzatore 3D**: 7 viste, misure punto-punto, ingombro, wireframe, colori personalizzabili, screenshot PNG, piatti dei progetti Bambu/Orca, componenti degli assiemi STEP, anteprima del G-code per layer.
- **Organizzazione**: filtri per formato, sorgente, cartella e tag; raccolte; vista "Senza raccolta". Note e tag restano legati al file anche se lo rinomini o lo sposti.
- **Duplicati**: copie esatte, stessa geometria (anche se spostata o in un altro formato) e probabili duplicati da rivedere.
- **Ricerca istantanea** per nome, percorso, tag, note e descrizione IA. Scorciatoia globale (predefinita ⌘/Ctrl+Maiusc+M).
- **IA facoltativa**: tag e descrizioni con OpenRouter, OpenAI, Anthropic, Gemini, Ollama o Codex CLI; ricerca semantica con embeddings. Parte solo su tua richiesta.
- **Slicer**: rileva 23 slicer (FDM e resina), apre i modelli nello slicer scelto, trascinamento verso altre app.
- **Coda di stampa** con tempi e filamento letti da G-code e 3MF, esportazione della checklist in Markdown o CSV.
- **Backup** di tag, raccolte, note, copertine e coda, manuale o automatico (giornaliero o settimanale).
- **Strumenti (beta)**: convertitore 3MF tra Bambu, Orca, Prusa e 3MF generico (mantiene piatti e colori, l'originale non viene toccato); generatori di targhette e vasi con esportazione STL/3MF.

## Compilare con GitHub Actions (consigliato)

1. Crea un repository su GitHub e carica questa cartella:
   ```bash
   git init && git add . && git commit -m "Reticolo"
   git branch -M main
   git remote add origin https://github.com/<utente>/reticolo.git
   git push -u origin main
   ```
2. Su GitHub apri **Actions → Build → Run workflow**. Al termine trovi `Reticolo-Mac-AppleSilicon` (.dmg) e `Reticolo-Windows-x64` (installer .exe), scaricabili per 3 giorni.
3. Per una release permanente: `git tag v0.1.0 && git push --tags` crea una bozza di release con i due installer.

Le build partono solo a richiesta o con un tag, per non consumare i minuti gratuiti di GitHub (repository privato).

### Primo avvio su macOS

L'app non è firmata con un certificato Apple Developer, quindi macOS la blocca al primo avvio. Dopo averla copiata in Applicazioni:

```bash
xattr -cr /Applications/Reticolo.app
```

In alternativa: Impostazioni di Sistema → Privacy e sicurezza → "Apri comunque".

Su Windows, SmartScreen può mostrare un avviso: clicca "Ulteriori informazioni" → "Esegui comunque".

## Compilare in locale

Servono Node.js 22 o successivo.

```bash
npm install
npm run dev          # compila l'interfaccia e avvia l'app
npm run dist:mac     # su un Mac → release/*.dmg (Apple Silicon)
npm run dist:win     # su Windows → release/*.exe (x64)
npm test             # test dei moduli
```

## Struttura

- `electron/` — processo principale: database SQLite (`node:sqlite` integrato, nessun modulo nativo), scansione e sorveglianza delle cartelle, archivi, estrazione di miniature e metadati, duplicati, coda, backup, 3MF, slicer, IA.
- `src/` — interfaccia React, visualizzatore Three.js e worker che genera le miniature.
- `test/` — test unitari e un test end-to-end (`npm run test:e2e`, richiede un display).

I dati (database, miniature, copertine, backup) stanno nella cartella dati dell'app: `~/Library/Application Support/Reticolo` su Mac, `%APPDATA%\Reticolo` su Windows.
