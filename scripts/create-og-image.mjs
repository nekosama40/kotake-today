import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "public", "og-image.png");
const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#f6f0e4"/>
  <circle cx="1060" cy="80" r="260" fill="#e3472e" opacity="0.10"/>
  <circle cx="80" cy="590" r="310" fill="#1e3d8f" opacity="0.08"/>
  <path d="M95 130h70" stroke="#1e3d8f" stroke-width="8"/>
  <text x="188" y="145" fill="#1e3d8f" font-family="sans-serif" font-size="30" font-weight="700" letter-spacing="5">TOKYO / TODAY</text>
  <text x="90" y="330" fill="#22201c" font-family="serif" font-size="108" font-weight="700">こたけから、</text>
  <text x="90" y="465" fill="#e3472e" font-family="serif" font-size="128" font-weight="700">きょう。</text>
  <text x="94" y="550" fill="#706b63" font-family="sans-serif" font-size="29">小竹向原から約1時間以内。今日から3日分の東京イベント。</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(outputPath);
console.log(`Created ${outputPath}`);
