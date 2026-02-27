import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { bridgeTool } from "../helpers.ts";
import { renderMarkdownResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	bridgeTool(
		pi,
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
				theme.fg("toolTitle", theme.bold("elixir_docs ")) + theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
		{ renderResult: renderMarkdownResult },
	);
}
