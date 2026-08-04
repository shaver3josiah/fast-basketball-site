import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const GOOGLE_CSS_URL = 'https://fonts.googleapis.com/css2?family=Anton&family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Barlow+Condensed:wght@500;600;700&family=Bebas+Neue&display=swap';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseFontFaces(css) {
  const blocks = css.split('@font-face').slice(1).map((b) => '@font-face' + b.split('}')[0] + '}');
  return blocks.map((block) => {
    const family = /font-family:\s*'([^']+)'/.exec(block)[1];
    const weight = /font-weight:\s*([0-9]+)/.exec(block)[1];
    const style = /font-style:\s*(\w+)/.exec(block)[1];
    const url = /url\(([^)]+)\)\s*format\('woff2'\)/.exec(block)[1];
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block);
    return { family, weight, style, url, unicodeRange: unicodeRange ? unicodeRange[1].trim() : null, block };
  });
}

function slugFamily(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function main() {
  const fontsDir = resolve('src/fonts');
  const outCss = resolve('src/styles/fonts.css');
  mkdirSync(fontsDir, { recursive: true });

  const cssRes = await fetch(GOOGLE_CSS_URL, { headers: { 'User-Agent': CHROME_UA } });
  if (!cssRes.ok) throw new Error('Failed to fetch Google Fonts CSS: ' + cssRes.status);
  const css = await cssRes.text();
  const faces = parseFontFaces(css);

  let outputCss = '';
  let count = 0;
  for (const face of faces) {
    const fileRes = await fetch(face.url);
    if (!fileRes.ok) {
      console.error('Skipping ' + face.family + ' ' + face.weight + ': failed to download ' + face.url);
      continue;
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const filename = slugFamily(face.family) + '-' + face.weight + '-' + face.style + (face.unicodeRange && face.unicodeRange.includes('0100') ? '-ext' : '') + '.woff2';
    writeFileSync(resolve(fontsDir, filename), buffer);
    outputCss += '@font-face{\n';
    outputCss += "  font-family:'" + face.family + "';\n";
    outputCss += '  font-style:' + face.style + ';\n';
    outputCss += '  font-weight:' + face.weight + ';\n';
    outputCss += '  font-display:swap;\n';
    outputCss += "  src:url('/fonts/" + filename + "') format('woff2');\n";
    if (face.unicodeRange) outputCss += '  unicode-range:' + face.unicodeRange + ';\n';
    outputCss += '}\n';
    count++;
  }

  writeFileSync(outCss, outputCss);
  console.log('Fetched ' + count + ' font files into ' + fontsDir);
  console.log('Wrote ' + outCss);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
