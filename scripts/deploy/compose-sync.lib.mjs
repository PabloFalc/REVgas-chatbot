const BLOCK_INDENT = '      ';

export function blockBounds(lines, configName) {
  const header = lines.indexOf(`  ${configName}:`);
  if (header < 0) throw new Error(`config ${configName} não encontrada no compose`);
  const contentLine = lines.findIndex((line, i) => i > header && line === '    content: |');
  if (contentLine < 0) throw new Error(`config ${configName} sem "content: |"`);
  let end = contentLine + 1;
  let last = contentLine;
  while (end < lines.length) {
    const line = lines[end];
    if (line.startsWith(BLOCK_INDENT)) last = end;
    else if (line.trim() !== '') break;
    end += 1;
  }
  return { start: contentLine + 1, end: last + 1 };
}

export function extractBlock(compose, configName) {
  const lines = compose.split('\n');
  const { start, end } = blockBounds(lines, configName);
  return `${lines
    .slice(start, end)
    .map(line => line.slice(BLOCK_INDENT.length))
    .join('\n')}\n`;
}

export function embedBlock(compose, configName, content) {
  const lines = compose.split('\n');
  const { start, end } = blockBounds(lines, configName);
  const body = content
    .replace(/\n+$/, '')
    .split('\n')
    .map(line => (line === '' ? '' : `${BLOCK_INDENT}${line}`));
  lines.splice(start, end - start, ...body);
  return lines.join('\n');
}
