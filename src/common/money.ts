export function formatInr(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const rupees = Math.floor(abs / 100);
  const paise = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}₹${rupees}.${paise}`;
}
