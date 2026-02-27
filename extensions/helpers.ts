import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { callTool, resolveUrl, getConnectionKind } from "./tidewave-client.ts";

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize };

export function truncated(text: string) {
	const t = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (!t.truncated) return t.content;
	return (
		t.content +
		`\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines, ${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)}]`
	);
}

export function formatHexSearchResults(raw: string): string {
	const countMatch = raw.match(/^Results: (\d+)/);
	const count = countMatch ? countMatch[1] : "?";

	const results: string[] = [];
	const re = /<result\s+index="(\d+)"\s+package="([^"]+)"\s+ref="([^"]+)"\s+title="([^"]*)">\n([\s\S]*?)\n<\/result>/g;
	let m;
	while ((m = re.exec(raw)) !== null) {
		const [, , pkg, ref, title, doc] = m;
		const trimmed = doc.trim();
		const url = `https://hexdocs.pm/${pkg.replace(/-([^-]+)$/, "/$1/")}${ref}`;
		results.push(`### ${title}\n${url}\n\n${trimmed}`);
	}

	if (results.length === 0) return raw;
	return `${count} results\n\n${results.join("\n\n---\n\n")}`;
}

export interface BridgeToolOpts {
	transformResult?: (text: string) => string;
	renderResult?: (result: any, options: any, theme: any) => any;
}

function noConnectionError() {
	return {
		content: [
			{
				type: "text" as const,
				text: "No BEAM connection for this project. Start the Phoenix server with `mix phx.server` or ensure mix.exs exists and the project compiles.",
			},
		],
		isError: true,
		details: {},
	};
}

function stillCompilingError() {
	return {
		content: [{ type: "text" as const, text: "The BEAM is still compiling. Wait a moment and try again." }],
		isError: true,
		details: {},
	};
}

function connectionError(cwd: string) {
	const starting = getConnectionKind(cwd) === "starting";
	return starting ? stillCompilingError() : noConnectionError();
}

export function bridgeTool(
	pi: ExtensionAPI,
	name: string,
	mcpName: string,
	label: string,
	description: string,
	parameters: ReturnType<typeof Type.Object>,
	renderCall: (args: Record<string, unknown>, theme: any) => any,
	opts?: BridgeToolOpts,
) {
	pi.registerTool({
		name,
		label,
		description,
		parameters,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const conn = await resolveUrl(ctx.cwd);
			if (!conn) return connectionError(ctx.cwd);

			let { text, isError } = await callTool(conn.url, mcpName, params, signal);
			if (opts?.transformResult) text = opts.transformResult(text);
			return {
				content: [{ type: "text" as const, text: truncated(text) }],
				isError,
				details: {},
			};
		},
		renderCall,
		renderResult: opts?.renderResult,
	});
}

export function evalTool(
	pi: ExtensionAPI,
	name: string,
	label: string,
	description: string,
	parameters: ReturnType<typeof Type.Object>,
	buildCode: (params: Record<string, unknown>) => string,
	renderCall: (args: Record<string, unknown>, theme: any) => any,
	opts?: BridgeToolOpts,
) {
	pi.registerTool({
		name,
		label,
		description,
		parameters,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const conn = await resolveUrl(ctx.cwd);
			if (!conn) return connectionError(ctx.cwd);

			const code = buildCode(params);
			let { text, isError } = await callTool(conn.url, "project_eval", { code }, signal);
			if (opts?.transformResult) text = opts.transformResult(text);
			return {
				content: [{ type: "text" as const, text: truncated(text) }],
				isError,
				details: {},
			};
		},
		renderCall,
		renderResult: opts?.renderResult,
	});
}
