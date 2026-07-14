import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const apiRoot = path.join(projectRoot, 'api');

const walk = (root, predicate) => {
  const results = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (predicate(fullPath)) results.push(fullPath);
    }
  };
  visit(root);
  return results;
};

const sourceFiles = walk(srcRoot, (file) => /\.(ts|tsx)$/.test(file));
const apiFiles = walk(apiRoot, (file) => file.endsWith('.ts'));

const routePatternFromFile = (file) => {
  let relative = path.relative(projectRoot, file).replaceAll(path.sep, '/').replace(/\.ts$/, '');
  relative = `/${relative}`;

  if (relative.endsWith('/index')) relative = relative.slice(0, -6) || '/';

  const escaped = relative
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[\\\.\\\.\\\.([^\]]+)\\\]/g, '.+')
    .replace(/\\\[([^\]]+)\\\]/g, '[^/]+');

  return new RegExp(`^${escaped}$`);
};

const apiPatterns = apiFiles.map((file) => ({ file, pattern: routePatternFromFile(file) }));
const routeRegex = /["'`]\/api\/[^"'`\s?]*/g;
const templateExpression = /\$\{[^}]+\}/g;
const usedRoutes = new Map();

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(routeRegex)) {
    const raw = match[0].slice(1);
    const route = raw.replace(templateExpression, '__PARAM__');
    const line = content.slice(0, match.index).split('\n').length;
    if (!usedRoutes.has(route)) usedRoutes.set(route, []);
    usedRoutes.get(route).push(`${path.relative(projectRoot, file)}:${line}`);
  }
}

const missing = [];
for (const [route, locations] of [...usedRoutes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const matches = apiPatterns.some(({ pattern }) => pattern.test(route));
  if (!matches) missing.push({ route, locations });
}

if (missing.length) {
  console.error('Rutas del frontend sin función Vercel correspondiente:');
  for (const item of missing) {
    console.error(`- ${item.route}`);
    for (const location of item.locations) console.error(`  ${location}`);
  }
  process.exit(1);
}

console.log(`Rutas Vercel correctas: ${usedRoutes.size} rutas del frontend verificadas contra ${apiFiles.length} funciones.`);
