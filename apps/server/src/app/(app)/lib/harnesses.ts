/**
 * Setup blocks per coding tool: how to point it at the gateway, send the key and the session name, and add the factory MCP server.
 * Facts come from each tool's own documentation (checked 2026-11-12, URLs in `docs/gateway.md`); a tool that cannot send a custom header or base URL says so instead of getting a block that would not work.
 * Pure: the key is never a value here (placeholders and `$BAUHERR_GATEWAY_KEY`), so nothing secret is rendered.
 */
export type Route = 'subscription' | 'api-key'
export type Block = { title: string; lang: 'bash' | 'json' | 'toml' | 'yaml' | 'text'; text: string }
export type Ctx = {
  /** Gateway address as a session on this machine reaches it. */
  gateway: string
  /** Factory MCP endpoint. */
  mcp: string
  workspace: string
  session: string
  role: string
  /** Gateway model ids of the Workspace tiers (`ws-<slug>/<connection>/<model>`); null while no LLM Connection exists. */
  models: { cheap: string; standard: string; strong: string } | null
}
/** `session`: the gateway tells this tool's sessions apart by name; `key`: only the key is sent, so its calls count under "Unnamed gateway session"; `none`: cannot go through the gateway. */
export type Level = 'session' | 'key' | 'none'
export type Harness = { id: string; label: string; level: Level; routes: Route[]; summary: string; docs: string; blocks: (c: Ctx, route: Route) => Block[] }

const KEY = '<session key>'
const AGENT = '<your agent key>'
export const ROUTE_LABEL: Record<Route, string> = { subscription: 'My own Claude subscription login', 'api-key': 'The Workspace API key' }
export const LEVEL_TEXT: Record<Level, string> = {
  session: 'Measured per session: tokens and cost show up under the session name.',
  key: 'Measured per key only: it cannot send a session name, so its calls appear as "Unnamed gateway session".',
  none: 'Not measurable through the gateway.',
}

const env = (c: Ctx): Block => ({
  title: 'Session key and name (once per terminal)',
  lang: 'bash',
  text: `read -rs BAUHERR_GATEWAY_KEY && export BAUHERR_GATEWAY_KEY   # paste the session key, press Enter\nexport BAUHERR_SESSION=${c.session} BAUHERR_ROLE=${c.role}`,
})

const m = (c: Ctx) => c.models ?? { cheap: `ws-${c.workspace}/<connection>/<cheap model>`, standard: `ws-${c.workspace}/<connection>/<standard model>`, strong: `ws-${c.workspace}/<connection>/<strong model>` }

const claudeHeaders = (withKey: boolean) =>
  `export ANTHROPIC_CUSTOM_HEADERS="$(printf '${withKey ? 'x-agw-key: %s\\n' : ''}x-bauherr-session: %s\\nx-bauherr-role: %s'${withKey ? ' "$BAUHERR_GATEWAY_KEY"' : ''} "$BAUHERR_SESSION" "$BAUHERR_ROLE")"`

const claudeCode = (c: Ctx, route: Route): Block[] => [
  env(c),
  route === 'subscription'
    ? { title: 'Point Claude Code at the gateway (keeps your Claude login)', lang: 'bash', text: `export ANTHROPIC_BASE_URL=${c.gateway}\n${claudeHeaders(true)}\nclaude` }
    : {
        title: 'Point Claude Code at the gateway (Workspace API key)',
        lang: 'bash',
        text: `export ANTHROPIC_BASE_URL=${c.gateway}\nexport ANTHROPIC_AUTH_TOKEN="$BAUHERR_GATEWAY_KEY"\n${claudeHeaders(false)}\nexport ANTHROPIC_DEFAULT_HAIKU_MODEL=${m(c).cheap}\nexport ANTHROPIC_DEFAULT_SONNET_MODEL=${m(c).standard}\nexport ANTHROPIC_DEFAULT_OPUS_MODEL=${m(c).strong}\nclaude`,
      },
  { title: 'Add the factory (once)', lang: 'bash', text: `claude mcp add --transport http bauherr ${c.mcp} --header "Authorization: Bearer ${AGENT}"` },
]

export const HARNESSES: Harness[] = [
  {
    id: 'claude-code',
    label: 'Claude Code (terminal, JetBrains, Agent SDK)',
    level: 'session',
    routes: ['subscription', 'api-key'],
    summary: 'JetBrains runs the same `claude` in its terminal. For the Agent SDK pass the same three variables in the `env` option (TypeScript: spread `process.env` first).',
    docs: 'https://code.claude.com/docs/en/llm-gateway-connect',
    blocks: claudeCode,
  },
  {
    id: 'claude-vscode',
    label: 'Claude Code in VS Code',
    level: 'session',
    routes: ['subscription', 'api-key'],
    summary: 'The session name is fixed per VS Code window or profile, so use one workspace setting per session.',
    docs: 'https://code.claude.com/docs/en/llm-gateway-connect#vs-code-extension',
    blocks: (c, route) => [
      {
        title: `Add to the VS Code settings (JSON) of this workspace`,
        lang: 'json',
        text: JSON.stringify(
          {
            'claudeCode.environmentVariables': [
              { name: 'ANTHROPIC_BASE_URL', value: c.gateway },
              { name: 'ANTHROPIC_CUSTOM_HEADERS', value: route === 'subscription' ? `x-agw-key: ${KEY}\nx-bauherr-session: ${c.session}\nx-bauherr-role: ${c.role}` : `x-bauherr-session: ${c.session}\nx-bauherr-role: ${c.role}` },
              ...(route === 'api-key' ? [{ name: 'ANTHROPIC_AUTH_TOKEN', value: KEY }, { name: 'ANTHROPIC_DEFAULT_SONNET_MODEL', value: m(c).standard }, { name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', value: m(c).cheap }, { name: 'ANTHROPIC_DEFAULT_OPUS_MODEL', value: m(c).strong }] : []),
            ],
          },
          null,
          2,
        ),
      },
      { title: 'Add the factory (once, in a terminal)', lang: 'bash', text: `claude mcp add --transport http bauherr ${c.mcp} --header "Authorization: Bearer ${AGENT}"` },
    ],
  },
  {
    id: 'claude-desktop',
    label: 'Claude desktop app (Code tab)',
    level: 'session',
    routes: ['api-key'],
    summary: 'The desktop app ignores ANTHROPIC_BASE_URL. Use its own third-party inference setting; whether it can keep a subscription login alongside is not documented, so only the Workspace API key is offered. Add the factory as an HTTP MCP server in the app with the address and Authorization header of the other tools.',
    docs: 'https://claude.com/docs/third-party/claude-desktop/gateway',
    blocks: (c) => [
      {
        title: 'Help, Troubleshooting, Enable Developer Mode, then Developer, Configure Third-Party Inference',
        lang: 'text',
        text: `Provider:        gateway\nGateway base URL: ${c.gateway}\nGateway API key:  ${KEY}\nAuth scheme:      Bearer\nModels:           ${m(c).standard}\nCustom headers:   x-bauherr-session: ${c.session}\n                  x-bauherr-role: ${c.role}`,
      },
    ],
  },
  {
    id: 'codex',
    label: 'OpenAI Codex CLI',
    level: 'session',
    routes: ['api-key'],
    summary: 'Codex speaks only the Responses API, so it needs an OpenAI Connection (preset "openai") in Settings, Connections. Its ChatGPT login is not routed through the gateway.',
    docs: 'https://learn.chatgpt.com/docs/config-file/config-reference',
    blocks: (c) => [
      env(c),
      {
        title: 'Add a provider to ~/.codex/config.toml (the file is user level; a project file is ignored)',
        lang: 'toml',
        text: `model_provider = "bauherr"\nmodel = "ws-${c.workspace}/<openai connection>/<model>"\n\n[model_providers.bauherr]\nname = "Bauherr gateway"\nbase_url = "${c.gateway}/v1"\nwire_api = "responses"\nenv_http_headers = { "x-agw-key" = "BAUHERR_GATEWAY_KEY", "x-bauherr-session" = "BAUHERR_SESSION", "x-bauherr-role" = "BAUHERR_ROLE" }`,
      },
      { title: 'Add the factory (once), also in ~/.codex/config.toml', lang: 'toml', text: `[mcp_servers.bauherr]\nurl = "${c.mcp}"\nbearer_token_env_var = "BAUHERR_AGENT_KEY"   # export BAUHERR_AGENT_KEY=${AGENT}` },
    ],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    level: 'key',
    routes: ['api-key'],
    summary: 'A custom endpoint works only with a Gemini API key (no Google login) and the CLI documents no custom header, so calls are measured per key. It needs a Gemini Connection (preset "gemini"), and the model name carries the gateway prefix.',
    docs: 'https://geminicli.com/docs/reference/configuration/',
    blocks: (c) => [
      { title: 'Point Gemini CLI at the gateway', lang: 'bash', text: `read -rs GEMINI_API_KEY && export GEMINI_API_KEY   # paste the session key, press Enter\nexport GOOGLE_GEMINI_BASE_URL=${c.gateway}\ngemini --model ws-${c.workspace}/<gemini connection>/<model>` },
      { title: 'Add the factory (once)', lang: 'bash', text: `gemini mcp add --transport http --header "Authorization: Bearer ${AGENT}" bauherr ${c.mcp}` },
    ],
  },
  {
    id: 'copilot-vscode',
    label: 'GitHub Copilot in VS Code (agent mode)',
    level: 'session',
    routes: ['api-key'],
    summary: 'Works through the "Custom Endpoint" model provider (bring your own key), which can send extra headers. Models must support tool calling. Your organisation may switch bring-your-own-key off.',
    docs: 'https://code.visualstudio.com/docs/copilot/customization/language-models',
    blocks: (c) => [
      {
        title: 'Add a model to chatLanguageModels.json (Chat: Manage Language Models)',
        lang: 'json',
        text: JSON.stringify({ name: 'Bauherr gateway', vendor: 'customendpoint', models: [{ id: m(c).standard, url: `${c.gateway}/v1/chat/completions`, apiKey: KEY, requestHeaders: { 'x-bauherr-session': c.session, 'x-bauherr-role': c.role }, toolCalling: true }] }, null, 2),
      },
      { title: 'Add the factory (.vscode/mcp.json)', lang: 'json', text: JSON.stringify({ servers: { bauherr: { type: 'http', url: c.mcp, headers: { Authorization: `Bearer ${AGENT}` } } } }, null, 2) },
    ],
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    level: 'key',
    routes: ['api-key'],
    summary: 'Bring-your-own-key providers in ~/.copilot/providers.json take a base URL and a bearer token but document no custom header, so calls are measured per key.',
    docs: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models',
    blocks: (c) => [
      { title: '~/.copilot/providers.json', lang: 'json', text: JSON.stringify({ providers: [{ name: 'bauherr', type: 'anthropic', baseUrl: c.gateway, bearerToken: KEY }], models: [{ id: 'bauherr-standard', provider: 'bauherr', wireModel: m(c).standard }] }, null, 2) },
      { title: 'Start it with that model', lang: 'bash', text: 'copilot --model bauherr/bauherr-standard' },
      { title: 'Add the factory (once)', lang: 'bash', text: `copilot mcp add --transport http bauherr ${c.mcp}\n# GitHub documents no header option here: put "Authorization: Bearer ${AGENT}" on the entry in ~/.copilot/mcp-config.json` },
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    level: 'none',
    routes: [],
    summary: 'Cursor sends model calls through its own servers and documents no base URL override, so a gateway on your machine is out of reach. Copilot in JetBrains documents no custom endpoint headers either.',
    docs: 'https://cursor.com/help/models-and-usage/api-keys',
    blocks: () => [],
  },
  {
    id: 'opencode',
    label: 'opencode',
    level: 'session',
    routes: ['api-key'],
    summary: 'A provider takes a base URL and static headers. The docs use two schemas (`providers.*.settings` and the older `provider.*.options`); check this against your installed version.',
    docs: 'https://opencode.ai/docs/providers/',
    blocks: (c) => [
      {
        title: '~/.config/opencode/opencode.json',
        lang: 'json',
        text: JSON.stringify(
          {
            providers: { bauherr: { name: 'Bauherr gateway', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${c.gateway}/v1`, apiKey: '{env:BAUHERR_GATEWAY_KEY}' }, headers: { 'x-bauherr-session': c.session, 'x-bauherr-role': c.role }, models: { [m(c).standard]: { name: 'Standard tier' } } } },
            model: `bauherr/${m(c).standard}`,
            mcp: { servers: { bauherr: { type: 'remote', url: c.mcp, oauth: false, headers: { Authorization: `Bearer ${AGENT}` } } } },
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'aider',
    label: 'Aider',
    level: 'session',
    routes: ['api-key'],
    summary: 'Through the OpenAI-compatible endpoint; extra headers come from a model settings file. Aider has no MCP client, so it cannot connect to the factory; its cost is still measured per session name.',
    docs: 'https://aider.chat/docs/config/adv-model-settings.html',
    blocks: (c) => [
      { title: 'Endpoint and key', lang: 'bash', text: `read -rs OPENAI_API_KEY && export OPENAI_API_KEY   # paste the session key, press Enter\nexport OPENAI_API_BASE=${c.gateway}/v1\naider --model openai/${m(c).standard}` },
      { title: '.aider.model.settings.yml in your home or project folder', lang: 'yaml', text: `- name: aider/extra_params\n  extra_params:\n    extra_headers:\n      x-bauherr-session: ${c.session}\n      x-bauherr-role: ${c.role}` },
    ],
  },
  {
    id: 'cline',
    label: 'Cline and Roo Code',
    level: 'key',
    routes: ['api-key'],
    summary: 'Pick the "OpenAI Compatible" provider. Neither documents a custom header for a personal install, so calls are measured per key.',
    docs: 'https://docs.cline.bot/provider-config/openai-compatible',
    blocks: (c) => [
      { title: 'In the provider settings', lang: 'text', text: `API provider: OpenAI Compatible\nBase URL:     ${c.gateway}/v1\nAPI key:      ${KEY}\nModel ID:     ${m(c).standard}` },
      { title: 'Add the factory (Cline: cline_mcp_settings.json, Roo Code: .roo/mcp.json with "type": "streamable-http")', lang: 'json', text: JSON.stringify({ mcpServers: { bauherr: { type: 'streamableHttp', url: c.mcp, headers: { Authorization: `Bearer ${AGENT}` } } } }, null, 2) },
    ],
  },
]

export const harnessOf = (id: string): Harness => HARNESSES.find((h) => h.id === id) ?? HARNESSES[0]!

/** Session names are the role plus four random hex digits, e.g. `engineer-3fa9`; `roll` is that random part. */
export const sessionName = (role: string, roll: string): string => `${role}-${roll}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64)

/** What a page hands to the setup block: the person's own values (never a secret) and the gateway's stored health. */
export type GatewaySetup = Omit<Ctx, 'session' | 'role'> & {
  /** Random four hex digits for the suggested session name. */
  roll: string
  /** Stored health check (`watch-gateway`): null before the first one. */
  up: boolean | null
  message: string | null
  /** Admin: may create a session key and open the gateway UI. */
  admin: boolean
}
