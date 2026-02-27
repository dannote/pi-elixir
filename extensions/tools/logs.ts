import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { bridgeTool } from "../helpers.ts";
import { renderLogResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	bridgeTool(
		pi,
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
		{ renderResult: renderLogResult },
	);
}
