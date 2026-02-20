import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { callTool, isReachable } from "./tidewave-client.ts";

const DEFAULT_URL = "http://localhost:4000/tidewave/mcp";

function truncated(text: string) {
	const t = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (!t.truncated) return t.content;
	return (
		t.content +
		`\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines, ${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)}]`
	);
}

function bridgeTool(
	pi: ExtensionAPI,
	url: string,
	name: string,
	mcpName: string,
	label: string,
	description: string,
	parameters: ReturnType<typeof Type.Object>,
	renderCall: (args: Record<string, unknown>, theme: any) => any,
	transformResult?: (text: string) => string,
) {
	pi.registerTool({
		name,
		label,
		description,
		parameters,
		async execute(_id, params, signal) {
			let { text, isError } = await callTool(url, mcpName, params, signal);
			if (transformResult) text = transformResult(text);
			return {
				content: [{ type: "text" as const, text: truncated(text) }],
				isError,
				details: {},
			};
		},
		renderCall,
	});
}

function formatHexSearchResults(raw: string): string {
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

export default function (pi: ExtensionAPI) {
	const url = DEFAULT_URL;
	let connected = false;

	function isElixirProject(cwd: string): boolean {
		try {
			const fs = require("node:fs");
			return fs.existsSync(`${cwd}/mix.exs`);
		} catch {
			return false;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!isElixirProject(ctx.cwd)) return;

		connected = await isReachable(url);
		const t = ctx.ui.theme;
		ctx.ui.setStatus(
			"elixir",
			connected
				? t.fg("success", "⬡") + " " + t.fg("muted", "BEAM")
				: t.fg("warning", "⬡") + " " + t.fg("muted", "BEAM offline"),
		);
	});

	bridgeTool(
		pi,
		url,
		"elixir_eval",
		"project_eval",
		"Elixir Eval",
		`Evaluate Elixir code in the running application.

Runs inside the BEAM with full access to project modules, deps, Ecto repos, and IEx helpers.
Use this instead of bash for anything Elixir — test functions, introspect modules, manipulate ASTs,
query process state, read docs with h(), list exports with exports(), inspect values with i().

Output truncated to ${DEFAULT_MAX_LINES} lines / ${formatSize(DEFAULT_MAX_BYTES)}.`,
		Type.Object({
			code: Type.String({ description: "Elixir code to evaluate" }),
			timeout: Type.Optional(Type.Integer({ description: "Timeout in ms (default: 30000)" })),
		}),
		(args, theme) => {
			const code = String(args.code ?? "");
			const preview = code.length > 120 ? code.slice(0, 117) + "…" : code;
			return new Text(
				theme.fg("toolTitle", theme.bold("elixir_eval ")) + theme.fg("accent", preview),
				0,
				0,
			);
		},
	);

	bridgeTool(
		pi,
		url,
		"elixir_docs",
		"get_docs",
		"Elixir Docs",
		`Get documentation for a module or function from the running application.
Returns exact docs for the exact versions in mix.lock.
Accepts: Module, Module.function, Module.function/arity, c:Module.callback/arity.`,
		Type.Object({
			reference: Type.String({
				description: "e.g. Ecto.Changeset, Ecto.Changeset.cast/4, c:GenServer.init/1",
			}),
		}),
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_docs ")) +
					theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
	);

	bridgeTool(
		pi,
		url,
		"elixir_source",
		"get_source_location",
		"Elixir Source",
		`Get source file:line for a module or function. The BEAM knows where everything is defined.
Accepts: Module, Module.function, Module.function/arity, dep:package_name.
Prefer over grep when you know the module/function name.`,
		Type.Object({
			reference: Type.String({
				description: "e.g. MyApp.Orders.create/1, dep:phoenix",
			}),
		}),
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_source ")) +
					theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
	);

	bridgeTool(
		pi,
		url,
		"elixir_sql",
		"execute_sql_query",
		"Elixir SQL",
		`Execute SQL through the app's Ecto repo. Results limited to 50 rows.
Use to verify migrations, check data, introspect schema.`,
		Type.Object({
			query: Type.String({ description: "SQL query" }),
			arguments: Type.Optional(Type.Array(Type.Unknown(), { description: "Query params" })),
			repo: Type.Optional(Type.String({ description: "Ecto repo module (default: first)" })),
		}),
		(args, theme) => {
			const q = String(args.query ?? "");
			const preview = q.length > 100 ? q.slice(0, 97) + "…" : q;
			return new Text(
				theme.fg("toolTitle", theme.bold("elixir_sql ")) + theme.fg("accent", preview),
				0,
				0,
			);
		},
	);

	bridgeTool(
		pi,
		url,
		"elixir_logs",
		"get_logs",
		"Elixir Logs",
		"Read server logs. Use after changes to check for compile/runtime errors.",
		Type.Object({
			tail: Type.Integer({ description: "Number of entries from the end" }),
			grep: Type.Optional(Type.String({ description: "Regex filter (case insensitive)" })),
			level: Type.Optional(Type.String({ description: "emergency|alert|critical|error|warning|notice|info|debug" })),
		}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_logs "));
			text += theme.fg("muted", `tail=${args.tail}`);
			if (args.grep) text += theme.fg("dim", ` grep=${args.grep}`);
			if (args.level) text += theme.fg("dim", ` level=${args.level}`);
			return new Text(text, 0, 0);
		},
	);

	bridgeTool(
		pi,
		url,
		"elixir_hex_search",
		"search_package_docs",
		"HexDocs Search",
		`Search HexDocs filtered to your project's exact dependency versions.`,
		Type.Object({
			q: Type.String({ description: "Search query" }),
			packages: Type.Optional(Type.Array(Type.String(), { description: "Limit to specific packages" })),
		}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_hex_search "));
			text += theme.fg("accent", `"${args.q}"`);
			return new Text(text, 0, 0);
		},
		formatHexSearchResults,
	);

	bridgeTool(
		pi,
		url,
		"elixir_schemas",
		"get_ecto_schemas",
		"Ecto Schemas",
		"List all Ecto schema modules with file paths. Prefer over grep for schema discovery.",
		Type.Object({}),
		(_args, theme) => new Text(theme.fg("toolTitle", theme.bold("elixir_schemas")), 0, 0),
	);
}
