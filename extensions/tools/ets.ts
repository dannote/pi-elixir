import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool, loadScript, wrapWithBindings } from "../helpers.ts";
import { renderElixirResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	evalTool(
		pi,
		"elixir_ets",
		"ETS Tables",
		`Inspect ETS tables in the running BEAM.
Without "table" — lists all tables sorted by memory (default), size, or name.
With "table" — shows table info and contents. Use "match" for pattern matching and "limit" to cap rows.`,
		Type.Object({
			table: Type.Optional(
				Type.String({ description: "Table name (atom) or ID to inspect. Omit to list all tables." }),
			),
			match: Type.Optional(
				Type.String({
					description:
						'Erlang match pattern for :ets.match_object, e.g. "{:_, :active, :_}" to match 3-tuples with :active as second element',
				}),
			),
			limit: Type.Optional(Type.Integer({ description: "Max rows to return (default: 50)" })),
			sort: Type.Optional(Type.String({ description: "Sort table list by: memory (default), size, name" })),
		}),
		(params) =>
			wrapWithBindings(loadScript("ets"), {
				table_name: params.table ?? null,
				match_pattern: params.match ?? null,
				max_rows: params.limit ?? 50,
				sort_by: params.sort ?? "memory",
			}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_ets"));
			if (args.table) text += theme.fg("accent", ` ${args.table}`);
			if (args.match) text += theme.fg("muted", ` match=${args.match}`);
			if (args.sort) text += theme.fg("muted", ` sort=${args.sort}`);
			return new Text(text, 0, 0);
		},
		{ renderResult: renderElixirResult },
	);
}
