// test-tts2.js
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const tts = new MsEdgeTTS();
await tts.setMetadata('es-AR-ElenaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

const result = await tts.toFile(
  './',
  'Hola mundo esto es una prueba de voz'
);

console.log('resultado toFile:', result);