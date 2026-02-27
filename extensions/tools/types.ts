import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool } from "../helpers.ts";
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
		(params) => buildCode(params),
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_types ")) + theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
		{ renderResult: renderElixirResult },
	);
}

function buildCode(params: Record<string, unknown>): string {
	const ref = String(params.reference);
	const hasFun = ref.includes(".");
	const hasArity = ref.includes("/");

	if (!hasFun) {
		const modAtom = `Module.concat([${ref
			.split(".")
			.map((s) => `:"${s}"`)
			.join(", ")}])`;
		return `
mod = ${modAtom}
Code.ensure_loaded!(mod)

types = case Code.Typespec.fetch_types(mod) do
  {:ok, types} ->
    types
    |> Enum.sort_by(fn {kind, {name, _, _}} -> {kind, name} end)
    |> Enum.map(fn {kind, type_ast} ->
      "@\#{kind} \#{Macro.to_string(Code.Typespec.type_to_quoted(type_ast))}"
    end)
  :error -> []
end

specs = case Code.Typespec.fetch_specs(mod) do
  {:ok, specs} ->
    Enum.flat_map(specs, fn {{fun, arity}, spec_list} ->
      Enum.map(spec_list, fn spec ->
        "@spec \#{Macro.to_string(Code.Typespec.spec_to_quoted(fun, spec))}"
      end)
    end)
    |> Enum.sort()
  :error -> []
end

callbacks = case Code.Typespec.fetch_callbacks(mod) do
  {:ok, cbs} ->
    Enum.flat_map(cbs, fn {{fun, arity}, spec_list} ->
      Enum.map(spec_list, fn spec ->
        "@callback \#{Macro.to_string(Code.Typespec.spec_to_quoted(fun, spec))}"
      end)
    end)
    |> Enum.sort()
  :error -> []
end

parts = []
parts = if types != [], do: parts ++ ["## Types\\n" <> Enum.join(types, "\\n")], else: parts
parts = if specs != [], do: parts ++ ["## Specs\\n" <> Enum.join(specs, "\\n")], else: parts
parts = if callbacks != [], do: parts ++ ["## Callbacks\\n" <> Enum.join(callbacks, "\\n")], else: parts

if parts == [] do
  "No types, specs, or callbacks found for \#{inspect(mod)}"
else
  "# \#{inspect(mod)}\\n\\n" <> Enum.join(parts, "\\n\\n")
end
`;
	}

	const parts = ref.split(".");
	const funPart = parts.pop()!;
	const modParts = parts;
	const modAtom = `Module.concat([${modParts.map((s) => `:"${s}"`).join(", ")}])`;

	let funName: string;
	let arityFilter: string;
	if (hasArity) {
		const [f, a] = funPart.split("/");
		funName = f;
		arityFilter = `arity == ${a}`;
	} else {
		funName = funPart;
		arityFilter = "true";
	}

	return `
mod = ${modAtom}
fun = :${funName}
Code.ensure_loaded!(mod)

specs = case Code.Typespec.fetch_specs(mod) do
  {:ok, specs} ->
    Enum.flat_map(specs, fn {{f, arity}, spec_list} ->
      if f == fun and ${arityFilter} do
        Enum.map(spec_list, fn spec ->
          "@spec \#{Macro.to_string(Code.Typespec.spec_to_quoted(f, spec))}"
        end)
      else
        []
      end
    end)
  :error -> []
end

if specs == [] do
  "No specs found for \#{inspect(mod)}.\#{fun}${hasArity ? `/${funPart.split("/")[1]}` : ""}"
else
  Enum.join(specs, "\\n")
end
`;
}
