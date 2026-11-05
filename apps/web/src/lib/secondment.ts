/** The report is due for the latest secondment until it is uploaded, whatever the current status [EP §5.3, DECISIONS §12]. */
export function needsSecondmentReport(e: {
  status?: string;
  secondment?: { destination?: string; reportedAt?: string | null } | null;
}): boolean {
  return !!e.secondment?.destination && !e.secondment.reportedAt;
}
