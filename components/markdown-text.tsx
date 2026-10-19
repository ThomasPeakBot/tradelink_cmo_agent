export function MarkdownText({ content }: { content: string }) {
  return (
    <div className="markdown">
      {content
        .split('\n')
        .map((line, i) =>
          line.startsWith('### ') ? (
            <h4 key={i}>{line.slice(4)}</h4>
          ) : line.startsWith('## ') ? (
            <h4 key={i}>{line.slice(3)}</h4>
          ) : line.startsWith('# ') ? (
            <h3 key={i}>{line.slice(2)}</h3>
          ) : line.trim() ? (
            <p key={i}>{line}</p>
          ) : null,
        )}
    </div>
  );
}
