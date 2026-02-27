import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool } from "../helpers.ts";

export function register(pi: ExtensionAPI) {
	evalTool(
		pi,
		"elixir_deps_tree",
		"Deps Tree",
		`Show compile-time dependencies for a module using Mix.Xref.
Lists modules that the given module calls (exports) and modules that call it (callers).
Use to understand coupling, find circular dependencies, and navigate unfamiliar codebases.`,
		Type.Object({
			module: Type.String({ description: "Module name, e.g. MyApp.Orders or MyAppWeb.OrderController" }),
			direction: Type.Optional(
				Type.String({
					description: "exports (modules this module calls, default), callers (modules that call this module), or both",
				}),
			),
		}),
		(params) => buildCode(params),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_deps_tree "));
			text += theme.fg("accent", String(args.module ?? ""));
			if (args.direction) text += theme.fg("muted", ` ${args.direction}`);
			return new Text(text, 0, 0);
		},
	);
}

function buildCode(params: Record<string, unknown>): string {
	const mod = String(params.module);
	const direction = params.direction ? String(params.direction) : "both";
	const modAtom = `Module.concat([${mod
		.split(".")
		.map((s) => `:"${s}"`)
		.join(", ")}])`;
	return `
target = ${modAtom}

all = Mix.Tasks.Xref.calls()

${
	direction === "exports" || direction === "both"
		? `
exports =
  all
  |> Enum.filter(fn %{caller_module: caller} -> caller == target end)
  |> Enum.map(fn %{callee: {m, f, a}} -> {m, f, a} end)
  |> Enum.uniq()
  |> Enum.sort()
  |> Enum.group_by(&elem(&1, 0))
  |> Enum.sort_by(fn {mod, _} -> inspect(mod) end)
`
		: "exports = []"
}

${
	direction === "callers" || direction === "both"
		? `
callers =
  all
  |> Enum.filter(fn %{callee: {m, _, _}} -> m == target end)
  |> Enum.map(fn %{caller_module: caller, callee: {_, f, a}} -> {caller, f, a} end)
  |> Enum.uniq()
  |> Enum.sort()
  |> Enum.group_by(&elem(&1, 0))
  |> Enum.sort_by(fn {mod, _} -> inspect(mod) end)
`
		: "callers = []"
}

format_group = fn grouped, header ->
  if grouped == [] do
    "\#{header}: (none)"
  else
    lines = Enum.map(grouped, fn {mod, funs} ->
      calls = Enum.map(funs, fn {_, f, a} -> "\#{f}/\#{a}" end) |> Enum.join(", ")
      "  \#{inspect(mod)} — \#{calls}"
    end)
    "\#{header} (\#{length(grouped)} modules):\\n" <> Enum.join(lines, "\\n")
  end
end

parts = []
${direction === "exports" || direction === "both" ? `parts = parts ++ [format_group.(exports, "Calls (this module depends on)")]` : ""}
${direction === "callers" || direction === "both" ? `parts = parts ++ [format_group.(callers, "Called by (depends on this module)")]` : ""}

"# \#{inspect(target)}\\n\\n" <> Enum.join(parts, "\\n\\n")
`;
}
