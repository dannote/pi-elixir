import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool, loadScript, wrapWithBindings } from "../helpers.ts";
import { renderElixirResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	evalTool(
		pi,
		"elixir_sup_tree",
		"Supervision Tree",
		`Show the supervision tree of the running application.
Returns a tree of supervisors and their children with PIDs, restart strategies, and child types.
Use to understand application architecture and process hierarchy.`,
		Type.Object({
			root: Type.Optional(
				Type.String({
					description: "Root supervisor module (default: auto-detected application supervisor). e.g. MyApp.Supervisor",
				}),
			),
			depth: Type.Optional(Type.Integer({ description: "Maximum tree depth to display (default: unlimited)" })),
		}),
		(params) =>
			wrapWithBindings(loadScript("sup_tree"), {
				root_module: params.root ?? null,
				max_depth: params.depth ?? null,
			}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_sup_tree"));
			if (args.root) text += theme.fg("accent", ` ${args.root}`);
			if (args.depth) text += theme.fg("muted", ` depth=${args.depth}`);
			return new Text(text, 0, 0);
		},
		{ renderResult: renderElixirResult },
	);
}
