export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} menit`;
  return rest ? `${hours} jam ${rest} menit` : `${hours} jam`;
}
