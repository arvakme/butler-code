import { createStaticStyles, cssVar } from 'antd-style';
import { Fragment, type ReactNode } from 'react';

// A small, safe Markdown for an Agent's round message: paragraphs, headings, lists, quotes, code, bold, italic, links (http and https only).
// It builds React elements and never injects HTML, so nothing in a message can run.

const styles = createStaticStyles(({ css }) => ({
  root: css`
    font-size: 13px;
    line-height: 1.75;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;

    > * + * {
      margin-block-start: 8px;
    }

    p,
    ul,
    ol,
    blockquote,
    pre,
    h4,
    h5 {
      margin: 0;
    }

    ul,
    ol {
      padding-inline-start: 20px;
    }

    h4,
    h5 {
      font-size: 13px;
      font-weight: 600;
    }

    blockquote {
      padding-inline-start: 10px;
      border-inline-start: 2px solid ${cssVar.colorBorder};
      color: ${cssVar.colorTextSecondary};
    }

    code {
      padding-inline: 4px;
      border-radius: 4px;
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      background: ${cssVar.colorFillTertiary};
    }

    pre {
      overflow: auto;
      padding: 10px 12px;
      border-radius: ${cssVar.borderRadius};
      background: ${cssVar.colorFillQuaternary};
    }

    pre code {
      padding: 0;
      background: none;
    }

    a {
      color: var(--brand);
    }
  `,
}));

function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const id = `${key}${match.index}`;
    if (match[1]) out.push(<code key={id}>{match[1].slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={id}>{inline(match[2].slice(2, -2), id)}</strong>);
    else if (match[3]) out.push(<em key={id}>{inline(match[3].slice(1, -1), id)}</em>);
    else {
      const label = match[4].slice(1, match[4].indexOf(']('));
      out.push(
        <a href={match[5]} key={id} rel={'noopener noreferrer'} target={'_blank'}>
          {label}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  const flush = (key: number, buffer: string[]) => buffer.length && blocks.push(<p key={key}>{buffer.map((line, n) => <Fragment key={n}>{n > 0 && <br />}{inline(line, `${key}-${n}-`)}</Fragment>)}</p>);
  let para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (fence) {
      flush(i, para);
      para = [];
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      blocks.push(<pre key={`c${i}`}><code>{code.join('\n')}</code></pre>);
      i++;
    } else if (heading) {
      flush(i, para);
      para = [];
      blocks.push(<h4 key={`h${i}`}>{inline(heading[1], `h${i}-`)}</h4>);
      i++;
    } else if (bullet || number) {
      flush(i, para);
      para = [];
      const ordered = Boolean(number);
      const items: string[] = [];
      while (i < lines.length) {
        const item = ordered ? lines[i].match(/^\s*\d+[.)]\s+(.*)$/) : lines[i].match(/^\s*[-*]\s+(.*)$/);
        if (!item) break;
        items.push(item[1]);
        i++;
      }
      const list = items.map((item, n) => <li key={n}>{inline(item, `l${i}-${n}-`)}</li>);
      blocks.push(ordered ? <ol key={`o${i}`}>{list}</ol> : <ul key={`u${i}`}>{list}</ul>);
    } else if (/^>\s?/.test(line)) {
      flush(i, para);
      para = [];
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={`q${i}`}>{inline(quote.join(' '), `q${i}-`)}</blockquote>);
    } else if (!line.trim()) {
      flush(i, para);
      para = [];
      i++;
    } else {
      para.push(line);
      i++;
    }
  }
  flush(lines.length, para);
  return <div className={styles.root}>{blocks}</div>;
}
