import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool } from "../helpers.ts";
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
		(params) => buildCode(params),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_sup_tree"));
			if (args.root) text += theme.fg("accent", ` ${args.root}`);
			if (args.depth) text += theme.fg("muted", ` depth=${args.depth}`);
			return new Text(text, 0, 0);
		},
		{ renderResult: renderElixirResult },
	);
}

function buildCode(params: Record<string, unknown>): string {
	const root = params.root ? String(params.root) : null;
	const depth = params.depth != null ? Number(params.depth) : null;
	const depthGuard = depth != null ? `depth < ${depth}` : "true";
	return `
defmodule PiSupTree do
  def print(sup, depth \\\\ 0) do
    indent = String.duplicate("  ", depth)
    children = try do
      Supervisor.which_children(sup)
    rescue
      _ -> []
    end

    children
    |> Enum.map(fn {id, pid, type, modules} ->
      id_str = if is_atom(id), do: inspect(id), else: "\#{inspect(id)}"
      pid_str = case pid do
        p when is_pid(p) -> inspect(p)
        :restarting -> "restarting"
        :undefined -> "undefined"
      end
      mod_str = case modules do
        :dynamic -> "dynamic"
        [m] -> inspect(m)
        ms -> inspect(ms)
      end

      line = "\#{indent}├─ \#{id_str} [\#{type}] \#{pid_str} (\#{mod_str})"

      sub = if type == :supervisor and is_pid(pid) and ${depthGuard} do
        try do
          info = Supervisor.count_children(pid)
          strategy = case :sys.get_status(pid) do
            {:status, _, _, [_, _, _, _, [header | _]]} ->
              case header do
                {_, _, {:data, data}} -> Keyword.get(data, :strategy, :unknown)
                _ -> :unknown
              end
            _ -> :unknown
          end
          header = "\#{indent}│  strategy=\#{strategy} active=\#{info[:active]} specs=\#{info[:specs]}"
          header <> "\\n" <> print(pid, depth + 1)
        rescue
          _ -> ""
        end
      else
        ""
      end

      if sub != "", do: line <> "\\n" <> sub, else: line
    end)
    |> Enum.join("\\n")
  end
end

root = ${
		root
			? `Process.whereis(Module.concat([${root
					.split(".")
					.map((s) => `:"${s}"`)
					.join(", ")}]))`
			: `
  app = Mix.Project.config()[:app]
  master = :application_controller.get_master(app)
  {top_sup, _mod} = :application_master.get_child(master)
  top_sup
`
	}

case root do
  nil -> "Could not auto-detect application supervisor. Pass root=MyApp.Supervisor explicitly."
  pid ->
    name = case Process.info(pid, :registered_name) do
      {:registered_name, name} when is_atom(name) -> inspect(name)
      _ -> inspect(pid)
    end
    strategy = try do
      case :sys.get_status(pid) do
        {:status, _, _, [_, _, _, _, [header | _]]} ->
          case header do
            {_, _, {:data, data}} -> Keyword.get(data, :strategy, :unknown)
            _ -> :unknown
          end
        _ -> :unknown
      end
    rescue
      _ -> :unknown
    end
    header = "#{name} (strategy=#{strategy})\\n"
    header <> PiSupTree.print(pid)
end
`;
}
