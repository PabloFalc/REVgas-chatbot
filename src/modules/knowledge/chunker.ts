import { createHash } from 'node:crypto';
import { normalizeText } from 'src/utils/text';
import type { KnowledgeChunkDraft, KnowledgeDocument } from './contracts/knowledge.types';

export const MAX_CHUNK_CHARS = 1200;

interface Section {
  title: string;
  body: string;
}

function slugify(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fileTitle(source: string): string {
  const name = source.split('/').pop() ?? source;
  return name.replace(/\.md$/i, '');
}

function splitSections(lines: string[], docTitle: string): Section[] {
  const sections: Section[] = [];
  let current: { title: string; lines: string[] } = { title: docTitle, lines: [] };

  const flush = () => {
    sections.push({ title: current.title, body: current.lines.join('\n').trim() });
  };

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = { title: heading[1], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

function splitBody(body: string): string[] {
  if (body.length <= MAX_CHUNK_CHARS) return [body];
  const parts: string[] = [];
  let buffer = '';
  for (const paragraph of body.split(/\n{2,}/)) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (buffer && candidate.length > MAX_CHUNK_CHARS) {
      parts.push(buffer);
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

export function chunkDocument(doc: KnowledgeDocument): KnowledgeChunkDraft[] {
  const lines = doc.markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const titleIndex = lines.findIndex(line => /^#\s+\S/.test(line));
  const docTitle =
    titleIndex >= 0 ? lines[titleIndex].replace(/^#\s+/, '').trim() : fileTitle(doc.source);
  const bodyLines = titleIndex >= 0 ? lines.filter((_, i) => i !== titleIndex) : lines;

  const usedSlugs = new Set<string>();
  const chunks: KnowledgeChunkDraft[] = [];

  for (const section of splitSections(bodyLines, docTitle)) {
    if (!section.body) continue;
    const baseSlug = slugify(section.title) || 'secao';
    splitBody(section.body).forEach((content, index) => {
      let slug = baseSlug;
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${baseSlug}-${n}`;
      usedSlugs.add(slug);

      const title = index === 0 ? section.title : `${section.title} (parte ${index + 1})`;
      const embeddingText = `${docTitle} — ${title}\n\n${content}`;
      chunks.push({
        key: `${doc.source}#${slug}`,
        source: doc.source,
        title,
        content,
        embeddingText,
        searchText: normalizeText(`${title} ${content}`),
        hash: createHash('sha256').update(embeddingText).digest('hex'),
      });
    });
  }
  return chunks;
}

export function chunkDocuments(docs: KnowledgeDocument[]): KnowledgeChunkDraft[] {
  return docs.flatMap(chunkDocument);
}
