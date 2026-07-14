import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const projectRoot = process.cwd();
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
const ts = projectRequire('typescript');

const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (fullPath.endsWith('.ts')) files.push(fullPath);
  }
};
walk(path.join(projectRoot, 'api'));
walk(path.join(projectRoot, 'server'));

const issues = [];
let checked = 0;

const getSqlText = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'query' &&
      node.arguments.length >= 2
    ) {
      const sql = getSqlText(node.arguments[0]);
      const params = node.arguments[1];
      if (sql && ts.isArrayLiteralExpression(params)) {
        const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
        const maximum = placeholders.length ? Math.max(...placeholders) : 0;
        if (maximum) {
          checked += 1;
          if (maximum !== params.elements.length) {
            const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            issues.push(
              `${path.relative(projectRoot, file)}:${location.line + 1} espera ${maximum} parámetros y recibe ${params.elements.length}`
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

if (issues.length) {
  console.error('Consultas SQL con cantidad de parámetros inconsistente:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Parámetros SQL correctos: ${checked} consultas literales verificadas.`);
