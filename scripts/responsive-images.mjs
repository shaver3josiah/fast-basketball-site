import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import sharp from 'sharp';

const WIDTHS = [320, 480, 640, 800, 1200];

function findSourceFile(src, sourceDirs) {
  const name = basename(src);
  for (const dir of sourceDirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function widthsFor(originalWidth) {
  const widths = WIDTHS.filter((w) => w <= originalWidth);
  if (widths.length === 0 || widths[widths.length - 1] !== originalWidth) {
    widths.push(originalWidth);
  }
  return widths;
}

async function generateVariants(key, image, sourceDirs, outDir) {
  const sourcePath = findSourceFile(image.src, sourceDirs);
  if (!sourcePath) {
    throw new Error('responsive image build could not find a source file for "' + key + '" (' + image.src + ')');
  }
  const baseName = basename(image.src).replace(/\.[^.]+$/, '');
  const widths = widthsFor(image.width);
  const variants = { webp: [], jpeg: [] };
  for (const width of widths) {
    const jpegName = baseName + '-' + width + '.jpg';
    const webpName = baseName + '-' + width + '.webp';
    await sharp(sourcePath).resize({ width }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(outDir, jpegName));
    await sharp(sourcePath).resize({ width }).webp({ quality: 78 }).toFile(join(outDir, webpName));
    variants.jpeg.push({ width, file: jpegName });
    variants.webp.push({ width, file: webpName });
  }
  return {
    originalWidth: image.width,
    originalHeight: image.height,
    aspectRatio: image.width / image.height,
    variants
  };
}

export async function generateResponsiveImages({ contentPath, sourceDirs, outDir }) {
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const result = {};
  for (const key of Object.keys(content.images)) {
    result[key] = await generateVariants(key, content.images[key], sourceDirs, outDir);
  }
  for (const extra of content.resumeExtra || []) {
    result[extra.id] = await generateVariants(extra.id, extra, sourceDirs, outDir);
  }
  return result;
}

export async function generateOgImage({ heroImage, sourceDirs, outDir }) {
  const sourcePath = findSourceFile(heroImage.src, sourceDirs);
  if (!sourcePath) return null;
  mkdirSync(outDir, { recursive: true });
  await sharp(sourcePath)
    .resize(1200, 630, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(join(outDir, 'og-cover.jpg'));
  return 'og-cover.jpg';
}

async function main() {
  const contentPath = resolve('src/data/content.json');
  const sourceDirs = [resolve('src/images/source'), resolve('src/images/uploads')];
  const outDir = resolve('dist/images');
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  const result = await generateResponsiveImages({ contentPath, sourceDirs, outDir });
  await generateOgImage({ heroImage: content.images['hero.nets'], sourceDirs, outDir });
  writeFileSync(resolve('src/data/responsive-manifest.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Generated responsive variants for ' + Object.keys(result).length + ' images into ' + outDir);
}

if (process.argv[1] && process.argv[1].endsWith('responsive-images.mjs')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
