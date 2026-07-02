/** App chrome palette (the reader page itself themes independently). */
export const colors = {
  bg: '#faf7f2',
  card: '#ffffff',
  ink: '#26221c',
  inkSoft: '#6b6459',
  accent: '#8b5e3c',
  accentSoft: '#f0e6da',
  danger: '#b3402a',
  border: '#e6dfd4',
};

export const bookTints = ['#8b5e3c', '#4a6d7c', '#6d5a7c', '#5f7c4a', '#7c4a55', '#3f6b5f'];

export function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return bookTints[Math.abs(hash) % bookTints.length]!;
}
