/** Operator-facing message when the listen port is already taken. */
export function formatEaddrInUseMessage(host: string, port: number): string {
  return (
    `h31d3nt0r: port ${host}:${port} is already in use — another instance may be running.\n` +
    `  Check: ./start.sh status\n` +
    `  Restart: ./start.sh stop && ./start.sh`
  );
}
