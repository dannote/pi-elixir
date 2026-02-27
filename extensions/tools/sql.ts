import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { bridgeTool } from "../helpers.ts";
import { renderSqlResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	bridgeTool(
		pi,
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
			return new Text(theme.fg("toolTitle", theme.bold("elixir_sql ")) + theme.fg("accent", preview), 0, 0);
		},
		{ renderResult: renderSqlResult },
	);
}
