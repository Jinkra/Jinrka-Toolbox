self.onmessage = ({ data: { pattern, flags, text, limit } }) => {
  try {
    const expression = new RegExp(pattern, flags);
    const matches = expression.global ? text.matchAll(expression) : [expression.exec(text)].filter(Boolean);
    const result = [];
    for (const match of matches) {
      if (result.length === limit) {
        result.push(`仅显示前 ${limit} 个匹配。`);
        break;
      }
      const captures = match.slice(1).map((value, index) => `  组 ${index + 1}  ${JSON.stringify(value ?? null)}`);
      result.push([`@${match.index}  ${JSON.stringify(match[0])}`, ...captures].join('\n'));
    }
    self.postMessage({ result: result.join('\n') || '没有匹配项。' });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
