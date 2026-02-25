import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";

let requestId = 0;

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: {
		content?: Array<{ type: string; text: string }>;
		isError?: boolean;
	};
	error?: { code: number; message: string };
}

export async function callTool(
	url: string,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ text: string; isError: boolean }> {
	const id = ++requestId;

	let resp: Response;
	try {
		resp = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method: "tools/call",
				params: { name, arguments: args },
			}),
			signal,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			text: `Could not reach BEAM at ${url} (${msg}). Is the Phoenix server running?`,
			isError: true,
		};
	}

	let json: JsonRpcResponse;
	try {
		json = await resp.json();
	} catch {
		return {
			text: `BEAM returned invalid response (HTTP ${resp.status}). The server may be starting up or misconfigured.`,
			isError: true,
		};
	}

	if (json.error) {
		return { text: `MCP error ${json.error.code}: ${json.error.message}`, isError: true };
	}

	const text = (json.result?.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return { text, isError: json.result?.isError ?? false };
}

// --- Tidewave discovery ---

interface TidewaveConfig {
	project_name: string;
	framework_type: string;
}

async function fetchConfig(baseUrl: string): Promise<TidewaveConfig | null> {
	try {
		const resp = await fetch(baseUrl.replace(/\/mcp$/, "/config"), {
			signal: AbortSignal.timeout(1000),
		});
		if (!resp.ok) return null;
		return (await resp.json()) as TidewaveConfig;
	} catch {
		return null;
	}
}

function readAppName(cwd: string): string | null {
	try {
		const mixExs = fs.readFileSync(`${cwd}/mix.exs`, "utf-8");
		const match = mixExs.match(/app:\s*:(\w+)/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

const PROBE_PORTS = [4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009];

async function discoverNativeTidewave(cwd: string): Promise<string | null> {
	const appName = readAppName(cwd);

	const probes = PROBE_PORTS.map(async (port) => {
		const url = `http://localhost:${port}/tidewave/mcp`;
		const config = await fetchConfig(url);
		return config ? { url, config } : null;
	});

	const results = (await Promise.all(probes)).filter(
		(r): r is { url: string; config: TidewaveConfig } => r !== null,
	);

	if (results.length === 0) return null;

	if (appName) {
		const match = results.find((r) => r.config.project_name === appName);
		if (match) return match.url;
	}

	return results[0].url;
}

// --- Embedded server management ---

interface EmbeddedProcess {
	proc: childProcess.ChildProcess;
	url: string;
	port: number;
}

const SCRIPT_PATH = path.resolve(__dirname, "../scripts/embedded_tidewave.exs");
const EMBEDDED_PORT_START = 4041;
const EMBEDDED_PORT_END = 4060;

const embeddedProcesses = new Map<string, EmbeddedProcess>();
let nextEmbeddedPort = EMBEDDED_PORT_START;

function pickPort(): number {
	const port = nextEmbeddedPort;
	nextEmbeddedPort++;
	if (nextEmbeddedPort > EMBEDDED_PORT_END) nextEmbeddedPort = EMBEDDED_PORT_START;
	return port;
}

async function startEmbedded(cwd: string): Promise<string | null> {
	const existing = embeddedProcesses.get(cwd);
	if (existing) {
		const config = await fetchConfig(existing.url.replace(/\/mcp$/, ""));
		if (config) return existing.url;
		stopEmbedded(cwd);
	}

	const port = pickPort();
	const url = `http://localhost:${port}/mcp`;

	return new Promise<string | null>((resolve) => {
		const proc = childProcess.spawn(
			"mix",
			["run", "--no-halt", SCRIPT_PATH, "--port", String(port)],
			{
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, MIX_ENV: "dev" },
			},
		);

		let resolved = false;
		let stderrBuf = "";

		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				proc.kill();
				resolve(null);
			}
		}, 30_000);

		proc.stdout!.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			if (!resolved && text.includes("PI_MCP_READY")) {
				resolved = true;
				clearTimeout(timeout);
				embeddedProcesses.set(cwd, { proc, url, port });

				proc.on("exit", () => {
					embeddedProcesses.delete(cwd);
				});

				resolve(url);
			}
		});

		proc.stderr!.on("data", (chunk: Buffer) => {
			stderrBuf += chunk.toString();
		});

		proc.on("error", () => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				resolve(null);
			}
		});

		proc.on("exit", (code) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				resolve(null);
			}
		});
	});
}

function stopEmbedded(cwd: string): void {
	const entry = embeddedProcesses.get(cwd);
	if (entry) {
		entry.proc.kill();
		embeddedProcesses.delete(cwd);
	}
}

export function stopAllEmbedded(): void {
	for (const [cwd] of embeddedProcesses) {
		stopEmbedded(cwd);
	}
}

// --- Unified URL resolution ---

export type ConnectionKind = "native" | "embedded" | null;

interface CachedConnection {
	url: string;
	kind: ConnectionKind;
	timestamp: number;
}

const connectionCache = new Map<string, CachedConnection>();
const CACHE_TTL = 30_000;
const startingProjects = new Set<string>();

export async function resolveUrl(cwd: string): Promise<{ url: string; kind: ConnectionKind } | null> {
	if (process.env.TIDEWAVE_URL) {
		return { url: process.env.TIDEWAVE_URL, kind: "native" };
	}

	const cached = connectionCache.get(cwd);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
		return { url: cached.url, kind: cached.kind };
	}

	const nativeUrl = await discoverNativeTidewave(cwd);
	if (nativeUrl) {
		connectionCache.set(cwd, { url: nativeUrl, kind: "native", timestamp: Date.now() });
		return { url: nativeUrl, kind: "native" };
	}

	if (process.env.PI_ELIXIR_DISABLE_EMBEDDED === "1") return null;

	const existing = embeddedProcesses.get(cwd);
	if (existing) {
		const config = await fetchConfig(existing.url.replace(/\/mcp$/, ""));
		if (config) {
			connectionCache.set(cwd, { url: existing.url, kind: "embedded", timestamp: Date.now() });
			return { url: existing.url, kind: "embedded" };
		}
		stopEmbedded(cwd);
	}

	if (startingProjects.has(cwd)) return null;

	startingProjects.add(cwd);
	try {
		const embeddedUrl = await startEmbedded(cwd);
		if (embeddedUrl) {
			connectionCache.set(cwd, { url: embeddedUrl, kind: "embedded", timestamp: Date.now() });
			return { url: embeddedUrl, kind: "embedded" };
		}
	} finally {
		startingProjects.delete(cwd);
	}

	return null;
}

export function invalidateCache(cwd: string): void {
	connectionCache.delete(cwd);
}

export function getConnectionKind(cwd: string): ConnectionKind {
	const cached = connectionCache.get(cwd);
	if (cached) return cached.kind;
	if (embeddedProcesses.has(cwd)) return "embedded";
	return null;
}
