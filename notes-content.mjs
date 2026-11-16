// Model-authored links are never treated as sources for document illustrations.
export function cleanNotes(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|data:)[^)]*\)/gi, '$1')
    .replace(/https?:\/\/[^\s<>]+/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function isGenericSummary(text) {
  const lines = cleanNotes(text).split(/\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(line => line && !line.startsWith('#'));
  const generic = lines.filter(line => /^(?:the\s+)?(?:lecture|conversation|speaker|professor|instructor)\s+(?:is\s+(?:about|a\b)|mentions\b|notes\b|talks about\b|discusses\b)/i.test(line));
  return lines.length >= 2 && generic.length / lines.length >= 0.75;
}
