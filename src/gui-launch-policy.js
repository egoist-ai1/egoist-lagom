export function isTrustedGuiLaunchArguments(args) {
  if (!Array.isArray(args) || args.length > 2) return false;
  const seen = new Set();
  for (const value of args) {
    if (!['--minimized', '--background'].includes(value) || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}
