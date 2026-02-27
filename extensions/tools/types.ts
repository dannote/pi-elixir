import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool, loadScript, wrapWithBindings } from "../helpers.ts";
import { renderElixirResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	evalTool(
		pi,
		"elixir_types",
		"Type Info",
		`Get type specifications and behaviour callbacks for a module or function.
Shows @type, @spec, @callback definitions. Use to understand function signatures and data structures.`,
		Type.Object({
			reference: Type.String({
				description: "Module name (for all types/specs) or Module.function/arity (for specific spec)",
			}),
		}),
		(params) => wrapWithBindings(loadScript("types"), { reference: String(params.reference) }),
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_types ")) + theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
		{ renderResult: renderElixirResult },
	);
}
