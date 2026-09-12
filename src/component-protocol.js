// Shared by the authenticated Core worker and the desktop facade.
function componentOperations() {
  const none = z.tuple([]);
  const profile = ZapretProfileInputSchema.max(160).refine(value => !/[\\/\r\n\0]/.test(value), 'Invalid profile name');
  const status = z.tuple([z.object({ force: z.boolean().optional() }).strict().optional()]);
  const entries = (names, schema = none) => Object.fromEntries(names.map(name => [name, schema]));
  return {
    SystemDoH: {
      ...entries(['stop', 'restart', 'stopAndRemove']), status,
      apply: z.tuple([
        z.string().max(2048).url().refine(value => new URL(value).protocol === 'https:', 'DoH requires HTTPS'),
        z.preprocess(value => typeof value === 'string' && value.trim() === '' ? undefined : value,
          z.string().regex(/^127\.0\.0\.(?:1|[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/).optional())
      ]),
      recover: z.tuple([z.object({ enabled: z.boolean(), url: z.string().max(2048), localAddress: z.string().max(64).optional() }).strict()]),
    },
    TelegramProxy: {
      ...entries(['start', 'stop', 'restart', 'installService', 'removeService', 'startService', 'stopService', 'checkForUpdates', 'installUpdate', 'shouldCheckUpdates', 'shutdownApplicationRuntime']),
      status, saveConfig: z.tuple([TelegramProxyConfigSchema]),
      tailLogs: z.tuple([z.number().int().min(1).max(300).optional()]),
    },
    Zapret: {
      ...entries(['listProfiles', 'getUserLists', 'startService', 'stopService', 'removeService', 'stopStandalone', 'updateIpsetList', 'checkForUpdates', 'installCoreUpdate', 'installDiscordRescueCore', 'resetNetworkState', 'runDiagnostics', 'cancelAutoSelect', 'autoSelectBestProfile', 'autoSelectProgress', 'clearVpnSuspension']),
      status,
      ...entries(['dryRunProfile', 'installService', 'setServiceProfile', 'startStandalone', 'restartStandalone'], z.tuple([profile.optional()])),
      saveUserLists: z.tuple([ZapretUserListsInputSchema]),
      setGameFilterMode: z.tuple([ZapretGameFilterModeSchema]),
      setIpsetMode: z.tuple([ZapretIpsetModeSchema]),
      setUpdateChecksEnabled: z.tuple([z.boolean()]),
      installCoreVersion: z.tuple([ZapretCoreVersionInputSchema]),
      prepareForVpn: z.tuple([z.boolean()]),
      restoreAfterVpnIfNeeded: z.tuple([z.boolean(), profile.optional(), z.object({ skipIdleStatus: z.boolean().optional() }).strict().optional()]),
    },
  };
}
const COMPONENT_QUERIES = new Set(['status', 'tailLogs', 'shouldCheckUpdates', 'cancelAutoSelect', 'autoSelectProgress']);
function validateComponentRequest(request) {
  const envelope = z.object({ id: z.string().max(128), component: z.enum(['SystemDoH', 'TelegramProxy', 'Zapret']), method: z.string().max(64), args: z.array(z.unknown()).max(4), query: z.boolean() }).strict().parse(request);
  const operations = componentOperations()[envelope.component];
  if (!Object.hasOwn(operations, envelope.method)) throw new Error('Unsupported component operation');
  if (envelope.query && !COMPONENT_QUERIES.has(envelope.method)) throw new Error('Mutation requires the serialized endpoint');
  // JSON encodes omitted positional arguments as null.
  const schema = operations[envelope.method];
  const positional = envelope.args.map(value => value === null ? undefined : value);
  while (positional.length < schema.items.length) positional.push(undefined);
  const args = schema.parse(positional);
  return { ...envelope, args };
}
