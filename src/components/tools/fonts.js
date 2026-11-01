// Font offline per i generatori (TTF Google Fonts con licenza OFL 1.1, dai pacchetti @expo-google-fonts)
// Parsing con opentype.js, conversione dei contorni in THREE.Shape.
import { parse as parseFont } from 'opentype.js';
import robotoBold from '@expo-google-fonts/roboto/700Bold/Roboto_700Bold.ttf?url';
import roboto from '@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf?url';
import bebas from '@expo-google-fonts/bebas-neue/400Regular/BebasNeue_400Regular.ttf?url';
import pacifico from '@expo-google-fonts/pacifico/400Regular/Pacifico_400Regular.ttf?url';
import mono from '@expo-google-fonts/roboto-mono/700Bold/RobotoMono_700Bold.ttf?url';

export const FONTS = [
  { id: 'roboto-bold', name: 'Roboto Bold', url: robotoBold },
  { id: 'roboto', name: 'Roboto', url: roboto },
  { id: 'bebas', name: 'Bebas Neue', url: bebas },
  { id: 'mono', name: 'Roboto Mono Bold', url: mono },
  { id: 'pacifico', name: 'Pacifico (corsivo)', url: pacifico, script: true },
];

const cache = new Map();
export function loadFont(id) {
  const f = FONTS.find(x => x.id === id) || FONTS[0];
  if (!cache.has(f.id)) {
    cache.set(f.id, fetch(f.url).then(r => r.arrayBuffer()).then(b => parseFont(b)));
  }
  return cache.get(f.id);
}

export { textShapes } from './textshapes.js';
