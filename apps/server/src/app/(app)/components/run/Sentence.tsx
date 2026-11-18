export function Sentence({ text }: { text: string }) {
  return text.split('`').map((part, i) => (i % 2 ? <span key={i} className="mono">{part}</span> : part))
}
