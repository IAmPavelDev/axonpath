// Verifies THEME (lib/theme.ts) and global.css define identical values for
// every token in both modes. theme.ts holds `radius` per mode; global.css
// declares `--radius` once on :root (inherited by .dark), so the dark-side
// radius resolves through the light block before comparison.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const themeTs = readFileSync(join(here, '..', 'lib', 'theme.ts'), 'utf8');
const globalCss = readFileSync(join(here, '..', 'global.css'), 'utf8');

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function parseThemeTs() {
  const modes = {};
  for (const mode of ['light', 'dark']) {
    const body = themeTs.slice(themeTs.indexOf(`${mode}: {`));
    const obj = body.slice(0, body.indexOf('},'));
    const tokens = {};
    for (const [, key, value] of obj.matchAll(/(\w+): '([^']+)'/g)) {
      tokens[key] = value;
    }
    modes[mode] = tokens;
  }
  return modes;
}

function parseGlobalCss() {
  const light = {};
  const lightBody = globalCss.slice(globalCss.indexOf(':root {'), globalCss.indexOf('.dark:root'));
  for (const [, name, value] of lightBody.matchAll(/--([\w-]+):\s*([^;]+);/g)) light[name] = value.trim();
  const dark = {};
  const darkBody = globalCss.slice(globalCss.indexOf('.dark:root'), globalCss.lastIndexOf('}'));
  for (const [, name, value] of darkBody.matchAll(/--([\w-]+):\s*([^;]+);/g)) dark[name] = value.trim();
  dark.radius ??= light.radius; // .dark:root inherits --radius from :root
  return { light, dark };
}

const theme = parseThemeTs();
const css = parseGlobalCss();
let failures = 0;
let checked = 0;

for (const mode of ['light', 'dark']) {
  for (const key of Object.keys(theme[mode]).filter((k) => k !== 'radius')) {
    const varName = kebab(key);
    const themeVal = theme[mode][key].replace(/^hsl\(|\)$/g, '').replace(/\s+/g, ' ').trim();
    const cssVal = (css[mode][varName] ?? '<missing>').replace(/\s+/g, ' ').trim();
    checked++;
    if (themeVal !== cssVal) {
      failures++;
      console.log(`MISMATCH ${mode}.${key}: theme.ts "${themeVal}" vs global.css "${cssVal}"`);
    }
  }
  // radius compared too (string value, css stores it bare)
  checked++;
  if (theme[mode].radius !== css[mode].radius) {
    failures++;
    console.log(`MISMATCH ${mode}.radius: theme.ts "${theme[mode].radius}" vs global.css "${css[mode].radius}"`);
  }
}

console.log(`${checked} token comparisons (${checked / 2} per mode): ${failures} mismatches`);
process.exit(failures ? 1 : 0);
