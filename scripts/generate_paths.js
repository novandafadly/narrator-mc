const fs = require('fs');
const fg = require('fast-glob');
const path = require('path');

const ROOT = path.join(__dirname, './../public').replace(/\\/g, '/');

const toPublicPath = (p) => p.replace(/\\/g, '/').slice(ROOT.length);

const bgImages = fg.globSync(`${ROOT}/bg/**/bg-*.jpg`, {dot: true}).map(toPublicPath);
const vrmList = [].concat(
  fg.globSync(`${ROOT}/avatar/**/*.glb`, {dot: true}).map(toPublicPath),
  fg.globSync(`${ROOT}/vrm/**/*.glb`, {dot: true}).map(toPublicPath),
  fg.globSync(`${ROOT}/vrm/**/*.vrm`, {dot: true}).map(toPublicPath),
);
const speechT5SpeakerEmbeddingsList = fg.globSync(`${ROOT}/speecht5_speaker_embeddings/**/*.bin`, {dot: true}).map(toPublicPath);
const animationList = [].concat(
  fg.globSync(`${ROOT}/animations/**/*.vrma`, {dot: true}).map(toPublicPath),
  fg.globSync(`${ROOT}/animations/**/*.fbx`, {dot: true}).map(toPublicPath)
);

let str = "";
str += `export const bgImages = ${JSON.stringify(bgImages)};\n`;
str += `export const vrmList = ${JSON.stringify(vrmList)};\n`;
str += `export const speechT5SpeakerEmbeddingsList = ${JSON.stringify(speechT5SpeakerEmbeddingsList)};\n`;
str += `export const animationList = ${JSON.stringify(animationList)};\n`;

fs.writeFileSync(path.join(__dirname, './../src/paths.ts'), str);
