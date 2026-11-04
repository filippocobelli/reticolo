#!/usr/bin/env python3
"""Genera docs/index.html (inglese) e docs/it/index.html (italiano) dallo stesso modello,
così le due lingue restano sempre allineate. Uso: python3 docs/build-site.py
Le pagine sono servite da GitHub Pages del repository (main /docs) su lab.cobelli.uk/reticolo/.
I font arrivano dal sito principale (/fonts/)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = 'filippocobelli/reticolo'
DL = f'https://github.com/{REPO}/releases/latest/download'
KOFI = 'https://ko-fi.com/filippocobelli'

T = {
 'en': dict(
  lang='en', free_label='free', other='it/', other_label='it', root='/reticolo/', title='Reticolo · free local manager for 3D model libraries',
  desc='Reticolo is a free, local manager for 3D printing, laser and CNC files on macOS and Windows: thumbnails, 3D viewer, tags, duplicates, slicers and print queue. No account, no uploads.',
  nav=('features', 'download', 'source'), toggle_aria='Switch colour theme', light='light', dark='dark',
  kicker='~/lab/reticolo $ open', lead='The free, local manager for your 3D model libraries. Everything you have scattered across folders, drives and the NAS, in one place, with thumbnails, a 3D viewer and one-click slicing.',
  mac='Download for Mac', mac_sub='Apple Silicon · macOS 12+', win='Download for Windows', win_sub='x64 · Windows 10/11',
  free='Free. No account, nothing uploaded, your files are never moved or renamed.', allrel='All releases',
  shot_alt='Reticolo library with thumbnails and the detail panel',
  feat_title='What it does', feats=[
   ('Library', 'Local folders, external drives and NAS shares, watched for changes. Thumbnails from the files themselves or rendered in 3D. ZIP, RAR and 7Z archives browsed like folders, without extracting.'),
   ('Organise', 'Tags, collections and notes that follow the file even when you rename or move it. Hide what you don’t need: hiding an archive hides everything inside it.'),
   ('Search', 'Instant search on names, paths, tags, notes and AI descriptions, optional semantic search, and a global shortcut to bring Reticolo forward.'),
   ('3D viewer', 'Seven views, point-to-point measurements, screenshots, Bambu/Orca multi-plate projects, STEP assemblies with their parts, G-code layer by layer.'),
   ('Duplicates', 'Exact copies, identical geometry even in another format, and probable duplicates for you to review. Nothing is ever deleted.'),
   ('Printing', 'Detects 23 FDM and resin slicers and opens files in the one you choose, or drag them in. Print queue with time and filament read from sliced files.'),
   ('Tools (beta)', '3MF converter between Bambu, Orca, Prusa and generic 3MF, keeping plates and colours. Nameplate and vase generators with STL/3MF export.'),
   ('Your way', 'Dark, light or automatic theme and the accent colour you like. Optional AI tags with OpenRouter, OpenAI, Anthropic, Gemini, Ollama or Codex. Automatic backups.'),
  ],
  gallery_title='A closer look', gallery=[
   ('viewer-3mf', 'Bambu project with two plates and two colours'),
   ('library-light', 'Light theme with a blue accent'),
   ('duplicates', 'Duplicates: exact copies, same geometry, to review'),
   ('nameplate', 'Nameplate generator with live 3D preview'),
   ('viewer-gcode', 'G-code preview by layer'),
   ('settings-light', 'Theme and accent colour'),
  ],
  formats_title='Formats', formats=[
   ('3D models', 'STL · 3MF · OBJ · FBX · STEP/STP · 3DM · Lychee LYS · Fusion F3D/F3Z · G-code · bgcode'),
   ('Meshes', 'GLB · PLY · glTF'), ('Archives', 'ZIP · RAR · 7Z · TAR · TGZ'),
   ('Laser & CNC', 'xTool XCS/XS · LightBurn · DXF · DWG'), ('Companions', 'images · videos · PDF · TXT · Markdown'),
  ],
  install_title='Installing', install_mac='<b>macOS.</b> Open the .dmg and drag Reticolo to Applications. The app isn’t signed with an Apple certificate, so before the first launch run this once in Terminal:',
  install_mac2='or go to System Settings → Privacy &amp; Security → Open Anyway.',
  install_win='<b>Windows.</b> Run the installer. If SmartScreen appears, choose More info → Run anyway.',
  lang_note='The app’s interface is in Italian for now.',
  privacy_title='Private by design', privacy='Reticolo works offline. No account, no telemetry, no uploads: your files are only read. The AI features are optional, off by default and use your own key; only the thumbnail and file name are sent, and only when you ask.',
  kofi_title='Reticolo is free', kofi_text='If it saves you time, you can buy me a coffee. It helps me keep building things like this.', kofi_btn='Support on Ko-fi',
  about='I’m not a programmer. I have plenty of ideas and build them with AI (Claude): I decide what they should do and test them at home, the AI writes the code. Bug reports and ideas are welcome on <a href="https://github.com/filippocobelli/reticolo/issues">GitHub</a>.',
  risk='<strong>As is.</strong> Reticolo is provided free of charge and without warranty of any kind. It only reads your files, but keep backups of what matters to you.',
  back='← lab.cobelli.uk',
 ),
 'it': dict(
  lang='it', free_label='gratis', other='../', other_label='en', root='/reticolo/', title='Reticolo · gestore locale e gratuito per librerie di modelli 3D',
  desc='Reticolo è un gestore locale e gratuito per i file di stampa 3D, laser e CNC su macOS e Windows: miniature, visualizzatore 3D, tag, duplicati, slicer e coda di stampa. Nessun account, nessun caricamento online.',
  nav=('funzioni', 'download', 'codice'), toggle_aria='Cambia tema', light='chiaro', dark='scuro',
  kicker='~/lab/reticolo $ open', lead='Il gestore locale e gratuito per le tue librerie di modelli 3D. Tutto quello che hai sparso tra cartelle, dischi e NAS in un posto solo, con miniature, visualizzatore 3D e invio allo slicer in un clic.',
  mac='Scarica per Mac', mac_sub='Apple Silicon · macOS 12+', win='Scarica per Windows', win_sub='x64 · Windows 10/11',
  free='Gratuito. Nessun account, nessun caricamento online, i tuoi file non vengono mai spostati o rinominati.', allrel='Tutte le versioni',
  shot_alt='Libreria di Reticolo con le miniature e il pannello dei dettagli',
  feat_title='Cosa fa', feats=[
   ('Libreria', 'Cartelle locali, dischi esterni e NAS, sorvegliati per le modifiche. Miniature prese dai file o generate in 3D. Archivi ZIP, RAR e 7Z sfogliati come cartelle, senza estrarli.'),
   ('Organizzare', 'Tag, raccolte e note che seguono il file anche se lo rinomini o lo sposti. Nascondi quello che non ti serve: nascondere un archivio nasconde anche il suo contenuto.'),
   ('Cercare', 'Ricerca istantanea su nomi, percorsi, tag, note e descrizioni IA, ricerca semantica facoltativa e una scorciatoia globale per richiamare Reticolo.'),
   ('Visualizzatore 3D', 'Sette viste, misure punto a punto, screenshot, progetti Bambu/Orca a più piatti, assiemi STEP con i componenti, G-code layer per layer.'),
   ('Duplicati', 'Copie esatte, stessa geometria anche in un altro formato e probabili duplicati da rivedere. Nulla viene mai cancellato.'),
   ('Stampa', 'Rileva 23 slicer FDM e resina e apre i file in quello che scegli, oppure li trascini. Coda di stampa con tempi e filamento letti dai file slicati.'),
   ('Strumenti (beta)', 'Convertitore 3MF tra Bambu, Orca, Prusa e 3MF generico, con piatti e colori. Generatori di targhette e vasi con esportazione STL/3MF.'),
   ('A modo tuo', 'Tema scuro, chiaro o automatico e il colore d’accento che preferisci. Tag con l’IA facoltativi (OpenRouter, OpenAI, Anthropic, Gemini, Ollama, Codex). Backup automatici.'),
  ],
  gallery_title='Più da vicino', gallery=[
   ('viewer-3mf', 'Progetto Bambu con due piatti e due colori'),
   ('library-light', 'Tema chiaro con accento blu'),
   ('duplicates', 'Duplicati: copie esatte, stessa geometria, da rivedere'),
   ('nameplate', 'Generatore di targhette con anteprima 3D'),
   ('viewer-gcode', 'Anteprima del G-code per layer'),
   ('settings-light', 'Tema e colore d’accento'),
  ],
  formats_title='Formati', formats=[
   ('Modelli 3D', 'STL · 3MF · OBJ · FBX · STEP/STP · 3DM · Lychee LYS · Fusion F3D/F3Z · G-code · bgcode'),
   ('Mesh', 'GLB · PLY · glTF'), ('Archivi', 'ZIP · RAR · 7Z · TAR · TGZ'),
   ('Laser e CNC', 'xTool XCS/XS · LightBurn · DXF · DWG'), ('Accompagnamento', 'immagini · video · PDF · TXT · Markdown'),
  ],
  install_title='Installazione', install_mac='<b>macOS.</b> Apri il .dmg e trascina Reticolo in Applicazioni. L’app non è firmata con un certificato Apple, quindi prima del primo avvio lancia una volta nel Terminale:',
  install_mac2='oppure vai in Impostazioni di Sistema → Privacy e sicurezza → Apri comunque.',
  install_win='<b>Windows.</b> Avvia l’installer. Se compare SmartScreen, scegli Ulteriori informazioni → Esegui comunque.',
  lang_note='',
  privacy_title='Privato per scelta', privacy='Reticolo funziona offline. Nessun account, nessuna telemetria, nessun caricamento: i tuoi file vengono solo letti. Le funzioni IA sono facoltative, spente all’inizio e usano la tua chiave; vengono inviati solo la miniatura e il nome del file, e solo quando lo chiedi tu.',
  kofi_title='Reticolo è gratuito', kofi_text='Se ti fa risparmiare tempo, puoi offrirmi un caffè. Mi aiuta a continuare a costruire cose come questa.', kofi_btn='Sostieni su Ko-fi',
  about='Non sono un programmatore. Ho tante idee e le realizzo con l’intelligenza artificiale (Claude): io decido cosa devono fare e le provo a casa, l’AI scrive il codice. Segnalazioni e idee sono benvenute su <a href="https://github.com/filippocobelli/reticolo/issues">GitHub</a>.',
  risk='<strong>Così com’è.</strong> Reticolo è fornito gratuitamente e senza garanzie di alcun tipo. Legge soltanto i tuoi file, ma tieni comunque un backup di ciò che ti è importante.',
  back='← lab.cobelli.uk',
 ),
}

CSS = r"""
@font-face{font-family:"Barlow";src:url(/fonts/Barlow-Regular.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Barlow";src:url(/fonts/Barlow-SemiBold.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Barlow Condensed";src:url(/fonts/BarlowCondensed-Bold.woff2) format("woff2");font-weight:700;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/fonts/JetBrainsMono-500.woff2) format("woff2");font-weight:500;font-display:swap}
[data-theme=dark]{--bg:#1C1C1C;--card:#232323;--text:#F2F1EC;--soft:#A3A29C;--line:#343433;--accent:#F2C400;--onaccent:#1C1C1C;--link:#FAFAF7}
[data-theme=light]{--bg:#FAFAF7;--card:#FFFFFF;--text:#1C1C1C;--soft:#5A5C62;--line:#E2E1DB;--accent:#C42424;--onaccent:#FFFFFF;--link:#1C1C1C}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;color:var(--text);background:var(--bg);font:400 18px/1.6 "Barlow",system-ui,sans-serif}
a{color:var(--link);text-decoration-color:var(--accent);text-underline-offset:3px;text-decoration-thickness:2px}a:hover{color:var(--accent)}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;font-size:14px;letter-spacing:-.2px}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:16px;height:64px}
.home{display:flex;align-items:center;gap:10px;text-decoration:none;margin-right:auto}
.cursor{display:inline-block;width:10px;height:18px;background:var(--accent);vertical-align:-3px}
nav{display:flex;align-items:center;gap:18px}nav a{text-decoration:none;color:var(--soft)}nav a:hover{color:var(--text)}
.toggle{background:none;border:1px solid var(--line);color:var(--soft);border-radius:6px;padding:6px 10px;cursor:pointer}.toggle:hover{color:var(--text);border-color:var(--soft)}
.hero{padding:64px 0 36px;display:grid;grid-template-columns:1fr;gap:28px}
.prompt{color:var(--soft);margin:0}.prompt b{color:var(--accent);font-weight:500}
.title{display:flex;align-items:center;gap:20px}.title img{width:84px;height:84px;border-radius:20px}
h1{font:700 clamp(64px,11vw,120px)/.85 "Barlow Condensed",sans-serif;margin:0;letter-spacing:-1px}
.lead{font-size:22px;max-width:34em;margin:0}
.status{display:inline-block;padding:2px 8px;border-radius:4px;color:var(--onaccent);background:var(--accent)}
.dl{display:flex;flex-wrap:wrap;gap:12px}
.btn{display:inline-flex;flex-direction:column;justify-content:center;min-width:240px;padding:12px 20px;border-radius:10px;text-decoration:none;border:1px solid var(--line);background:var(--card);color:var(--text)}
.btn b{font:700 22px/1.1 "Barlow Condensed",sans-serif}.btn span{font-size:13px;color:var(--soft)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--onaccent)}.btn.primary span{color:var(--onaccent);opacity:.8}
.btn:hover{border-color:var(--accent);color:inherit}.btn.primary:hover{filter:brightness(1.05);color:var(--onaccent)}
.note{color:var(--soft);font-size:15px;margin:0}
.shot{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card)}
.shot img{display:block;width:100%;height:auto}
[data-theme=dark] .only-light,[data-theme=light] .only-dark{display:none}
h2{font:700 40px/1.05 "Barlow Condensed",sans-serif;margin:0 0 18px}
section{padding:40px 0 8px}
.feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.feat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.feat h3{font:700 24px/1.1 "Barlow Condensed",sans-serif;margin:0 0 6px}.feat p{margin:0;color:var(--soft);font-size:16px;line-height:1.5}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
figure{margin:0}figure figcaption{color:var(--soft);font-size:15px;margin-top:6px}
table{border-collapse:collapse;width:100%}td{padding:10px 0;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{width:180px;color:var(--soft)}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;margin:8px 0}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
.kofi{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;border-left:3px solid var(--accent);border-radius:0 12px 12px 0}
.kofi p{margin:4px 0 0;color:var(--soft)}.kofi h3{font:700 28px/1 "Barlow Condensed",sans-serif;margin:0}
.kofi a.btn{min-width:0;flex-direction:row;align-items:center;gap:8px;font-weight:600}
@media(max-width:640px){.kofi{grid-template-columns:1fr}.btn{min-width:0;width:100%}nav a:not([hreflang]){display:none}.home .mono{font-size:13px}}
.about{margin:28px 0 0;padding:20px 22px;border-left:3px solid var(--accent);background:var(--card);border-radius:0 12px 12px 0}.about p{margin:0}
.risk{margin:28px auto 0;font-size:.8rem;line-height:1.5;color:var(--soft)}
footer{padding:16px 0 56px;color:var(--soft)}footer .wrap{display:flex;flex-wrap:wrap;gap:10px 22px}
"""

def page(t):
    r = t['root']
    feats = '\n'.join(f'      <div class="feat"><h3>{h}</h3><p>{p}</p></div>' for h, p in t['feats'])
    gal = '\n'.join(f'      <figure><div class="shot"><img src="{r}img/{f}.webp" alt="{c}" loading="lazy" width="1440" height="873"></div><figcaption>{c}</figcaption></figure>' for f, c in t['gallery'])
    fmts = '\n'.join(f'      <tr><td>{a}</td><td class="mono">{b}</td></tr>' for a, b in t['formats'])
    canonical = 'https://lab.cobelli.uk/reticolo/' + ('it/' if t['lang'] == 'it' else '')
    lang_note = f'<p class="note">{t["lang_note"]}</p>' if t['lang_note'] else ''
    return f"""<!doctype html>
<html lang="{t['lang']}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t['title']}</title>
<meta name="description" content="{t['desc']}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" hreflang="en" href="https://lab.cobelli.uk/reticolo/">
<link rel="alternate" hreflang="it" href="https://lab.cobelli.uk/reticolo/it/">
<link rel="icon" href="{r}favicon.png" type="image/png">
<meta property="og:title" content="Reticolo">
<meta property="og:description" content="{t['desc']}">
<meta property="og:image" content="https://lab.cobelli.uk/reticolo/img/library-dark.webp">
<script>try{{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<style>{CSS.replace('ROOT', r)}</style>
</head>
<body>
<header><div class="wrap">
  <a class="home" href="/"><span class="mono">lab.cobelli.uk/reticolo</span><span class="cursor" aria-hidden="true"></span></a>
  <nav class="mono">
    <a href="#features">{t['nav'][0]}</a>
    <a href="#download">{t['nav'][1]}</a>
    <a href="https://github.com/{REPO}">{t['nav'][2]}</a>
    <a href="{t['other']}" hreflang="{t['other_label']}" lang="{t['other_label']}">{t['other_label']}</a>
    <button class="toggle mono" id="toggle" type="button" aria-label="{t['toggle_aria']}">{t['light']}</button>
  </nav>
</div></header>

<main class="wrap">
  <section class="hero" id="download">
    <p class="prompt mono"><b>~/lab/reticolo</b> $ open</p>
    <div class="title"><img src="{r}img/icon.png" alt="" width="84" height="84"><h1>Reticolo</h1></div>
    <p><span class="status mono" data-repo="{REPO}">v0.2.1 · {t['free_label']}</span></p>
    <p class="lead">{t['lead']}</p>
    <div class="dl">
      <a class="btn primary" href="{DL}/Reticolo-mac-arm64.dmg"><b>{t['mac']}</b><span>{t['mac_sub']}</span></a>
      <a class="btn" href="{DL}/Reticolo-win-x64.exe"><b>{t['win']}</b><span>{t['win_sub']}</span></a>
    </div>
    <p class="note">{t['free']} <a href="https://github.com/{REPO}/releases">{t['allrel']}</a> · <a href="{KOFI}">Ko-fi</a></p>
    {lang_note}
    <div class="shot"><img class="only-dark" src="{r}img/library-dark.webp" alt="{t['shot_alt']}" width="1440" height="873"><img class="only-light" src="{r}img/library-light.webp" alt="{t['shot_alt']}" width="1440" height="873"></div>
  </section>

  <section id="features">
    <h2>{t['feat_title']}</h2>
    <div class="feats">
{feats}
    </div>
  </section>

  <section>
    <h2>{t['gallery_title']}</h2>
    <div class="gallery">
{gal}
    </div>
  </section>

  <section>
    <h2>{t['formats_title']}</h2>
    <table>
{fmts}
    </table>
  </section>

  <section>
    <h2>{t['install_title']}</h2>
    <div class="box">
      <p style="margin-top:0">{t['install_mac']}</p>
      <pre class="mono">xattr -cr /Applications/Reticolo.app</pre>
      <p>{t['install_mac2']}</p>
      <p style="margin-bottom:0">{t['install_win']}</p>
    </div>
  </section>

  <section>
    <h2>{t['privacy_title']}</h2>
    <p style="margin:0;max-width:44em">{t['privacy']}</p>
  </section>

  <section>
    <div class="box kofi">
      <div><h3>{t['kofi_title']}</h3><p>{t['kofi_text']}</p></div>
      <a class="btn primary" href="{KOFI}">☕ {t['kofi_btn']}</a>
    </div>
    <div class="about"><p>{t['about']}</p></div>
  </section>
</main>

<p class="risk wrap">{t['risk']}</p>

<footer><div class="wrap mono">
  <a href="/{'it/' if t['lang'] == 'it' else ''}">{t['back']}</a>
  <a href="https://github.com/{REPO}">github</a>
  <a href="{KOFI}">ko-fi</a>
</div></footer>

<script>
(function(){{
  var b=document.getElementById("toggle"),r=document.documentElement;
  function label(){{b.textContent=r.dataset.theme==="dark"?"{t['light']}":"{t['dark']}"}}
  label();
  b.onclick=function(){{r.dataset.theme=r.dataset.theme==="dark"?"light":"dark";try{{localStorage.setItem("theme",r.dataset.theme)}}catch(e){{}}label()}};
}})();
</script>
<script>
/* Versione letta in automatico dall'ultima release GitHub (cache 1 ora). */
(function(){{
  document.querySelectorAll("[data-repo]").forEach(function(el){{
    var repo=el.getAttribute("data-repo"),key="release:"+repo,now=Date.now(),c=null;
    function show(tag){{if(tag)el.textContent="v"+String(tag).replace(/^v/i,"")+" · {t['free_label']}"}}
    try{{c=JSON.parse(localStorage.getItem(key))}}catch(e){{}}
    if(c&&c.tag){{show(c.tag);if(now-c.t<3600000)return}}
    fetch("https://api.github.com/repos/"+repo+"/releases/latest",{{headers:{{Accept:"application/vnd.github+json"}}}})
      .then(function(r){{return r.ok?r.json():null}})
      .then(function(j){{if(j&&j.tag_name){{show(j.tag_name);try{{localStorage.setItem(key,JSON.stringify({{tag:j.tag_name,t:now}}))}}catch(e){{}}}}}})
      .catch(function(){{}});
  }});
}})();
</script>
</body>
</html>
"""

for k, out in (('en', 'index.html'), ('it', 'it/index.html')):
    p = os.path.join(HERE, out)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(page(T[k]))
    print('scritto', out)
