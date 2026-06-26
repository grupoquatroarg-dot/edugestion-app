import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { TextDecoder } from "node:util";

const root = process.cwd();
const excludedDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".html",
  ".css", ".md", ".sql", ".txt", ".yml", ".yaml", ".env",
]);
const specialTextFiles = new Set([".env.example", ".env.txt"]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const mojibakePatterns = [
  { label: "carácter de reemplazo Unicode", regex: /\uFFFD/u },
  { label: "secuencia típica de doble codificación (U+00C3)", regex: /\u00C3/u },
  { label: "secuencia típica de doble codificación (U+00C2)", regex: /\u00C2/u },
  { label: "secuencia típica de puntuación mal decodificada", regex: /\u00E2\u20AC/u },
  { label: "BOM interpretado como texto", regex: /\u00EF\u00BB\u00BF/u },
  { label: "carácter de control C1", regex: /[\u0080-\u009F]/u },
];

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    if (excludedDirectories.has(entry)) continue;
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      visit(absolutePath);
      continue;
    }
    const extension = extname(entry).toLowerCase();
    if (textExtensions.has(extension) || specialTextFiles.has(entry)) files.push(absolutePath);
  }
};

visit(root);
const problems = [];

for (const file of files) {
  const buffer = readFileSync(file);
  let text;
  try {
    text = decoder.decode(buffer);
  } catch {
    problems.push(`${relative(root, file)}: no es UTF-8 válido`);
    continue;
  }

  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const pattern of mojibakePatterns) {
      if (pattern.regex.test(line)) {
        problems.push(`${relative(root, file)}:${index + 1}: ${pattern.label}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error("Se detectaron problemas de encoding:");
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log(`Encoding correcto: ${files.length} archivos UTF-8 sin mojibake.`);
